const https = require('https');

/**
 * Tome auto-completion module.
 * After each match, fetches the active quest and submits completion progress.
 * Based on Cursed Market's "Guaranteed Quests" feature.
 */
class TomeCompleter {
    constructor() {
        this.enabled = false;
        this.lastSuccessfulMatch = { matchId: null, krakenMatchId: null };
        this.completedCount = 0;
        this.onEvent = null; // callback for UI updates

        // Captured game session headers (populated by proxy snooping)
        this.gameHeaders = {};
        this.platformHost = null;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
    }

    /**
     * Called by proxy when it captures game request headers.
     * We need these to authenticate our own API calls.
     */
    captureHeaders(headers, host) {
        if (headers['api-key']) this.gameHeaders['api-key'] = headers['api-key'];
        if (headers['user-agent']) this.gameHeaders['user-agent'] = headers['user-agent'];
        if (headers['x-kraken-client-platform']) this.gameHeaders['x-kraken-client-platform'] = headers['x-kraken-client-platform'];
        if (headers['x-kraken-client-provider']) this.gameHeaders['x-kraken-client-provider'] = headers['x-kraken-client-provider'];
        if (headers['x-kraken-client-os']) this.gameHeaders['x-kraken-client-os'] = headers['x-kraken-client-os'];
        if (headers['x-kraken-client-version']) this.gameHeaders['x-kraken-client-version'] = headers['x-kraken-client-version'];
        if (headers['cookie']) this.gameHeaders['cookie'] = headers['cookie'];
        if (host) this.platformHost = host;
    }

    _hasHeaders() {
        return this.platformHost && this.gameHeaders['cookie'] && this.gameHeaders['api-key'];
    }

    _emit(type, data = {}) {
        if (this.onEvent) this.onEvent({ type, ...data });
    }

    /**
     * Makes an HTTPS request to the game API using captured headers.
     */
    _apiRequest(method, apiPath, body = null) {
        return new Promise((resolve, reject) => {
            const headers = {
                ...this.gameHeaders,
                'Content-Type': 'application/json',
            };
            if (body) {
                headers['Content-Length'] = Buffer.byteLength(body);
            }

            const options = {
                hostname: this.platformHost,
                port: 443,
                path: apiPath,
                method,
                headers,
            };

            const req = https.request(options, (res) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    resolve({ statusCode: res.statusCode, body: raw });
                });
            });

            req.on('error', reject);
            if (body) req.write(body);
            req.end();
        });
    }

    /**
     * Fetches the player's currently active tome quest.
     */
    async _getActiveQuest(role) {
        if (!this._hasHeaders()) return null;

        try {
            const res = await this._apiRequest('GET', '/api/v1/archives/stories/get/activeNode');
            if (res.statusCode !== 200) {
                console.log(`[Tomes] Failed to get active quest: HTTP ${res.statusCode}`);
                return null;
            }

            const data = JSON.parse(res.body);
            const roleKey = role === 'killer' ? 'killerActiveNode' : 'survivorActiveNode';
            const roleNode = data[roleKey];
            if (!roleNode || !roleNode.nodeId) {
                console.log(`[Tomes] No active ${role} quest found`);
                return null;
            }

            // Find the matching node in activeNode array to get objectives
            let currentProgress = 0;
            let neededProgression = 0;
            const questEvents = [];

            if (data.activeNode) {
                for (const node of data.activeNode) {
                    if (node.nodeTreeCoordinate && node.nodeTreeCoordinate.nodeId === roleNode.nodeId) {
                        if (node.objectives) {
                            for (const obj of node.objectives) {
                                currentProgress = obj.currentProgress || 0;
                                neededProgression = obj.neededProgression || 0;
                                if (obj.questEvent) {
                                    for (const evt of obj.questEvent) {
                                        questEvents.push(evt);
                                    }
                                }
                            }
                        }
                        break;
                    }
                }
            }

            return {
                level: roleNode.level,
                nodeId: roleNode.nodeId,
                storyId: roleNode.storyId,
                currentProgress,
                neededProgression,
                questEvents,
            };
        } catch (err) {
            console.error(`[Tomes] Error getting active quest: ${err.message}`);
            return null;
        }
    }

    /**
     * Called when a match ends. Extracts match data from analytics and completes the active quest.
     * matchData: { matchId, krakenMatchId }
     * role: 'survivor' | 'killer'
     */
    async completeActiveQuest(matchData, role) {
        if (!this.enabled) return;
        if (!matchData.matchId || !matchData.krakenMatchId) return;

        // Deduplication — don't reuse the same match
        if (matchData.matchId === this.lastSuccessfulMatch.matchId ||
            matchData.krakenMatchId === this.lastSuccessfulMatch.krakenMatchId) {
            console.log('[Tomes] Match already used, skipping');
            return;
        }

        const quest = await this._getActiveQuest(role);
        if (!quest || !quest.nodeId) {
            this._emit('no-quest');
            return;
        }

        if (quest.currentProgress >= quest.neededProgression) {
            console.log('[Tomes] Quest already complete');
            this._emit('already-complete', { nodeId: quest.nodeId });
            return;
        }

        // Calculate remaining progression and adjust quest events
        const remaining = quest.neededProgression - quest.currentProgress;
        const events = JSON.parse(JSON.stringify(quest.questEvents)); // deep clone
        if (events.length === 1 && events[0].repetition <= quest.neededProgression) {
            events[0].repetition = remaining;
        }

        const requestBody = JSON.stringify({
            matchId: matchData.matchId,
            krakenMatchId: matchData.krakenMatchId,
            questEvents: events,
            role: role,
        });

        try {
            const res = await this._apiRequest('POST', '/api/v1/archives/stories/update/quest-progress-v3/', requestBody);
            // Server returns 100 (CONTINUE) on success
            if (res.statusCode === 100 || res.statusCode === 200) {
                this.lastSuccessfulMatch = matchData;
                this.completedCount++;
                console.log(`[Tomes] Quest completed! (${quest.currentProgress}/${quest.neededProgression} → ${quest.neededProgression}/${quest.neededProgression})`);
                this._emit('completed', {
                    nodeId: quest.nodeId,
                    storyId: quest.storyId,
                    progress: `${quest.currentProgress} → ${quest.neededProgression}`,
                    total: this.completedCount,
                });
            } else {
                console.log(`[Tomes] Quest update failed: HTTP ${res.statusCode}`);
                this._emit('error', { message: `HTTP ${res.statusCode}` });
            }
        } catch (err) {
            console.error(`[Tomes] Error completing quest: ${err.message}`);
            this._emit('error', { message: err.message });
        }
    }

    getStatus() {
        return {
            enabled: this.enabled,
            hasHeaders: this._hasHeaders(),
            completedCount: this.completedCount,
            lastMatch: this.lastSuccessfulMatch.matchId ? this.lastSuccessfulMatch.matchId.substring(0, 8) : null,
        };
    }
}

module.exports = TomeCompleter;
