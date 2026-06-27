const { findPath } = require('./pathfinding');
const { getApiConfig } = require('./api-config');
const { ApiClient, formatApiError } = require('./api-client');

/**
 * FarmEngine - sniping/farming loop on the v2 + bulk-spending-bloodweb endpoints.
 *
 *   - Probe with POST /api/v1/dbd-character-data/bloodweb/v2 (operationOrder: [])
 *   - When a sniper target is found on the current bloodweb:
 *       * mode 'collect' -> POST /bloodweb/v2 with PLAYER operationOrder for the
 *         entire path-to-target (every node on the path is bought).
 *       * mode 'skip'    -> POST /bloodweb/v2 with PLAYER operationOrder for the
 *         path-to-target where the target itself is the only intended outcome
 *         (still buys the path because BHVR requires path connectivity).
 *     In both modes, every other Available node is blocked as ENTITY so the
 *     level still advances.
 *   - When no target on this bloodweb -> POST /bulk-spending-bloodweb with
 *     entityBlockedNodeIds = every Available node, numOfLevel: 1.
 *   - When bloodWebLevel === 51 -> POST /bulk-spending-bloodweb with
 *     entityBlockedNodeIds: ["0"] to consume the prestige node and reset.
 *
 * Pacing & error handling come from ApiClient (same model as PrestigeEngine):
 *   1ms base + adaptive backoff; 429/403/BlW_deductCur_invalid handled.
 */
class FarmEngine {
    constructor() {
        this.isCancelled = false;
        this.isRunning = false;
    }

    cancel() {
        this.isCancelled = true;
    }

    async run({ bhvrSession: apiKey, characterId, platform, sniperConfig, mode, contentNameMap, headerOverrides }, onEvent) {
        if (this.isRunning) {
            onEvent('log', { message: 'Error: Farming is already running.' });
            return { snipedItems: {}, bloodwebsProcessed: 0, error: 'Already running' };
        }
        if (!sniperConfig || sniperConfig.length === 0) {
            onEvent('log', { message: 'Error: No items selected to snipe.' });
            return { snipedItems: {}, bloodwebsProcessed: 0, error: 'No sniper config' };
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

        const snipedItemsSummary = {};
        let bloodwebsProcessed = 0;
        let startingBP = null;
        let data;

        onEvent('log', { message: `Starting farm for ${characterId} (mode: ${mode})` });
        onEvent('log', { message: `Targeting ${sniperConfig.length} item(s)` });

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
                return this._finishWithError(probeResult, snipedItemsSummary, bloodwebsProcessed, onEvent);
            }
            data = probeResult.data;
            startingBP = this._totalBP(data);

            while (!this.isCancelled) {
                this._emitStats(data, startingBP, onEvent);

                let url;
                let body;
                let label;

                if (data.bloodWebLevel === 51) {
                    // Farm mode never prestiges: consume the prestige node to reset.
                    onEvent('log', { message: 'Bloodweb level 51 reached — resetting without prestige.' });
                    url = apiCfg.urls.bulkSpend;
                    body = {
                        characterName: characterId,
                        entityBlockedNodeIds: ["0"],
                        numOfLevel: 1,
                        selectedNodeIds: []
                    };
                    label = 'l51-reset';
                } else {
                    const snipe = this._findSnipeTarget(data, sniperConfig, contentNameMap);

                    if (snipe) {
                        const purchasePath = (mode === 'skip')
                            ? snipe.path                       // still need full path; target is final
                            : snipe.path;                      // collect = same path; both modes buy connectivity
                        const blockedIds = this._collectAvailable(data, new Set(purchasePath));
                        const operationOrder = purchasePath.map(nodeId => ({ actor: 'PLAYER', selectedNodeId: nodeId }));
                        url = apiCfg.urls.buy;
                        body = {
                            characterName: characterId,
                            entityBlockedNodeIds: blockedIds,
                            operationOrder,
                            selectedNodeIds: purchasePath
                        };
                        label = 'snipe-buy';
                        onEvent('log', { message: `Sniped: ${snipe.name}` });
                        snipedItemsSummary[snipe.name] = (snipedItemsSummary[snipe.name] || 0) + 1;
                        onEvent('snipedItem', { name: snipe.name, total: snipedItemsSummary[snipe.name] });
                    } else {
                        // No target on this bloodweb — fast-forward via bulk-spending-bloodweb.
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

                bloodwebsProcessed++;
                onEvent('log', { message: `Bloodweb #${bloodwebsProcessed} | Level ${data.bloodWebLevel}` });

                const result = await client.post(url, body, { isCancelled, label });
                if (!result.ok) {
                    if (result.reason === 'CANCELLED') {
                        onEvent('log', { message: 'Farming stopped by user.' });
                        break;
                    }
                    this.isRunning = false;
                    return this._finishWithError(result, snipedItemsSummary, bloodwebsProcessed, onEvent);
                }
                data = result.data;
            }

            onEvent('log', { message: 'Farming stopped.' });
            this.isRunning = false;
            return { snipedItems: snipedItemsSummary, bloodwebsProcessed };
        } catch (error) {
            onEvent('log', { message: `Farm error: ${error.message}` });
            this.isRunning = false;
            return { snipedItems: snipedItemsSummary, bloodwebsProcessed, error: error.message };
        }
    }

    _totalBP(data) {
        if (!data || !data.updatedWallets) return null;
        const bp = data.updatedWallets.find(w => w.currency === 'Bloodpoints')?.balance || 0;
        const bonus = data.updatedWallets.find(w => w.currency === 'BonusBloodpoints')?.balance || 0;
        return bp + bonus;
    }

    _emitStats(data, startingBP, onEvent) {
        const currentBP = this._totalBP(data);
        if (currentBP !== null && startingBP !== null) {
            onEvent('stats', {
                bloodpointsSpent: startingBP - currentBP,
                startingBalance: startingBP,
                currentBalance: currentBP
            });
        }
    }

    _findSnipeTarget(data, sniperConfig, contentNameMap) {
        if (!data.bloodWebData || !data.bloodWebData.ringData) return null;
        for (const ring of data.bloodWebData.ringData) {
            for (const node of ring.nodeData || []) {
                if (sniperConfig.includes(node.contentId) && node.state === 'Available') {
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

    _finishWithError(result, snipedItems, bloodwebsProcessed, onEvent) {
        const errorMsg = formatApiError(result);
        onEvent('log', { message: `Farm error: ${errorMsg}` });
        return {
            snipedItems,
            bloodwebsProcessed,
            error: errorMsg,
            reason: result.reason
        };
    }
}

module.exports = FarmEngine;
