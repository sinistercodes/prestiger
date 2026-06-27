const { findPath } = require('./pathfinding');
const { getApiConfig } = require('./api-config');
const { ApiClient, formatApiError } = require('./api-client');

/**
 * PrestigeEngine - matches the reference DBD prestige injector's mechanics:
 *
 *   1. Probe via POST /api/v1/dbd-character-data/bloodweb/v2 (with operationOrder: [])
 *   2. Loop:
 *        a. If bloodWebLevel === 51 -> POST /bulk-spending-bloodweb
 *           with selectedNodeIds=["0"] (the prestige-up call). 50-99 ms settle
 *           delay first; up to 5 retries on transient errors.
 *        b. Else, optionally snipe a target item via /bloodweb/v2
 *           with PLAYER operationOrder entries (path-based purchase).
 *        c. Otherwise, fast-forward the level via POST /bulk-spending-bloodweb
 *           with entityBlockedNodeIds = every available node, numOfLevel: 1.
 *
 * Pacing & rate limiting live in ApiClient:
 *   - 1ms base + adaptive (0..3000ms) + +/-10% jitter before every request
 *   - 429 -> adaptive +10ms, wait 1500-2500ms, retry forever
 *   - 403 -> 50s IP cooldown, retry forever
 *   - 400 + "BlW_deductCur_invalid" -> clean OUT_OF_BLOODPOINTS stop
 */
class PrestigeEngine {
    constructor() {
        this.isCancelled = false;
        this.isRunning = false;
    }

    cancel() {
        this.isCancelled = true;
    }

    async run({ bhvrSession: apiKey, characterId, prestigeCount, platform, sniperConfig, contentNameMap, headerOverrides }, onEvent) {
        if (this.isRunning) {
            onEvent('log', { message: 'Error: A prestige is already running.' });
            return { prestigesDone: 0, totalTarget: 0, snipedItems: {}, error: 'Already running' };
        }
        this.isCancelled = false;
        this.isRunning = true;

        const apiCfg = getApiConfig(platform, apiKey, headerOverrides);
        if (headerOverrides && headerOverrides['user-agent']) {
            onEvent('log', { message: `Using captured live headers (UA: ${String(headerOverrides['user-agent']).slice(0, 60)}…)` });
        }
        const client = new ApiClient({
            baseUrl: apiCfg.baseUrl,
            headers: apiCfg.headers,
            onEvent
        });
        const isCancelled = () => this.isCancelled;

        const targetPrestiges = Math.min(Math.max(parseInt(prestigeCount) || 1, 1), 100);
        const sniper = sniperConfig || [];

        onEvent('log', { message: `Starting Prestige for ID: ${characterId} - ${targetPrestiges} prestige(s)` });

        const snipedItemsSummary = {};
        let prestigesDone = 0;
        let data;

        try {
            onEvent('log', { message: 'Probing bloodweb (v2)...' });
            const probeResult = await client.post(apiCfg.urls.probe, {
                characterName: characterId,
                entityBlockedNodeIds: [],
                operationOrder: [],
                selectedNodeIds: []
            }, { isCancelled, maxRetries: 3, label: 'probe' });

            if (!probeResult.ok) {
                this.isRunning = false;
                return this._finishWithError(probeResult, prestigesDone, targetPrestiges, snipedItemsSummary, onEvent);
            }
            data = probeResult.data;

            while (prestigesDone < targetPrestiges) {
                if (this.isCancelled) {
                    onEvent('log', { message: 'Process cancelled by user.' });
                    break;
                }

                this._emitProgress(data, prestigesDone, targetPrestiges, onEvent);

                let url;
                let body;
                let label;
                let maxRetries = Infinity;
                let isPrestigeStep = false;

                if (data.bloodWebLevel === 51) {
                    // Prestige up: a single bulk-spending-bloodweb with selectedNodeIds=["0"].
                    onEvent('log', { message: `Prestige Up! (${prestigesDone + 1}/${targetPrestiges})` });
                    // Brief settle delay so the server commits the level-51 state.
                    await this._jitterSleep(50, 100);
                    url = apiCfg.urls.bulkSpend;
                    body = {
                        characterName: characterId,
                        entityBlockedNodeIds: [],
                        numOfLevel: 1,
                        selectedNodeIds: ["0"]
                    };
                    label = 'prestige-up';
                    maxRetries = 5;
                    isPrestigeStep = true;
                } else {
                    // Look for a snipe target on this bloodweb.
                    const snipe = this._findSnipeTarget(data, sniper, contentNameMap);

                    if (snipe) {
                        // Buy the path via /bloodweb/v2 with PLAYER operationOrder
                        // and block every remaining available node so the level still advances.
                        const blockedIds = this._collectAvailable(data, new Set(snipe.path));
                        const operationOrder = snipe.path.map(nodeId => ({ actor: 'PLAYER', selectedNodeId: nodeId }));
                        url = apiCfg.urls.buy;
                        body = {
                            characterName: characterId,
                            entityBlockedNodeIds: blockedIds,
                            operationOrder,
                            selectedNodeIds: snipe.path
                        };
                        label = 'snipe-buy';
                        onEvent('log', { message: `Target item sniped: ${snipe.name}` });
                        snipedItemsSummary[snipe.name] = (snipedItemsSummary[snipe.name] || 0) + 1;
                    } else {
                        // No snipe target — fast-forward the entire level via bulk-spending-bloodweb.
                        const blockedIds = this._collectAvailable(data, null);
                        if (blockedIds.length === 0) {
                            onEvent('log', { message: 'No available nodes. Stopping.' });
                            break;
                        }
                        url = apiCfg.urls.bulkSpend;
                        body = {
                            characterName: characterId,
                            entityBlockedNodeIds: blockedIds,
                            numOfLevel: 1,
                            selectedNodeIds: []
                        };
                        label = 'bulk-spend';
                    }
                }

                const result = await client.post(url, body, { isCancelled, maxRetries, label });
                if (!result.ok) {
                    if (result.reason === 'CANCELLED') {
                        onEvent('log', { message: 'Process cancelled by user.' });
                        break;
                    }
                    this.isRunning = false;
                    return this._finishWithError(result, prestigesDone, targetPrestiges, snipedItemsSummary, onEvent);
                }
                data = result.data;
                if (isPrestigeStep) prestigesDone++;
            }

            onEvent('summary', { snipedItems: snipedItemsSummary });
            onEvent('log', { message: `Prestige completed. ${prestigesDone}/${targetPrestiges} done.` });
            this.isRunning = false;
            return { prestigesDone, totalTarget: targetPrestiges, snipedItems: snipedItemsSummary };
        } catch (error) {
            onEvent('log', { message: `Unexpected error: ${error.message}` });
            this.isRunning = false;
            return {
                prestigesDone,
                totalTarget: targetPrestiges,
                snipedItems: snipedItemsSummary,
                error: error.message
            };
        }
    }

    _emitProgress(data, prestigesDone, targetPrestiges, onEvent) {
        const totalBloodpoints = this._totalBP(data);
        onEvent('log', {
            message: `Prestige ${prestigesDone + 1}/${targetPrestiges} - P:${data.prestigeLevel} | Level ${data.bloodWebLevel}/50`
        });
        if (totalBloodpoints !== null) onEvent('bloodpoints', { value: totalBloodpoints });
        onEvent('progress', {
            prestigesDone: prestigesDone + 1,
            totalTarget: targetPrestiges,
            bloodWebLevel: data.bloodWebLevel,
            prestigeLevel: data.prestigeLevel
        });
    }

    _totalBP(data) {
        if (!data || !data.updatedWallets) return null;
        const bp = data.updatedWallets.find(w => w.currency === 'Bloodpoints')?.balance || 0;
        const bonus = data.updatedWallets.find(w => w.currency === 'BonusBloodpoints')?.balance || 0;
        return bp + bonus;
    }

    _findSnipeTarget(data, sniper, contentNameMap) {
        if (!sniper.length || !data.bloodWebData || !data.bloodWebData.ringData) return null;
        for (const ring of data.bloodWebData.ringData) {
            for (const node of ring.nodeData || []) {
                if (sniper.includes(node.contentId) && node.state === 'Available') {
                    const path = findPath('0', node.nodeId, data.bloodWebData.paths);
                    if (!path) continue;
                    return {
                        nodeId: node.nodeId,
                        contentId: node.contentId,
                        name: contentNameMap?.get(node.contentId) || node.contentId,
                        path
                    };
                }
            }
        }
        return null;
    }

    _collectAvailable(data, excludeSet) {
        const ids = [];
        if (!data.bloodWebData || !data.bloodWebData.ringData) return ids;
        for (const ring of data.bloodWebData.ringData) {
            for (const node of ring.nodeData || []) {
                if (!node.nodeId) continue;
                if (excludeSet && excludeSet.has(node.nodeId)) continue;
                if (node.state !== 'Available') continue;
                ids.push(node.nodeId);
            }
        }
        return ids;
    }

    async _jitterSleep(minMs, maxMs) {
        const ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    _finishWithError(result, prestigesDone, totalTarget, snipedItems, onEvent) {
        const errorMsg = formatApiError(result);
        onEvent('log', { message: `Error: ${errorMsg}` });
        return {
            prestigesDone,
            totalTarget,
            snipedItems,
            error: errorMsg,
            reason: result.reason
        };
    }
}

module.exports = PrestigeEngine;
