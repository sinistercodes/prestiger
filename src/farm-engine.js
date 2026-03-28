const axios = require('axios');
const { findPath } = require('./pathfinding');
const { getApiConfig } = require('./api-config');

class FarmEngine {
    constructor() {
        this.isCancelled = false;
        this.isRunning = false;
    }

    cancel() {
        this.isCancelled = true;
    }

    async run({ bhvrSession: apiKey, characterId, platform, sniperConfig, mode, contentNameMap }, onEvent) {
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

        const { url, headers } = getApiConfig(platform, apiKey);
        const snipedItemsSummary = {};
        let bloodwebsProcessed = 0;
        let startingBP = null;

        onEvent('log', { message: `Starting farm for ${characterId} (mode: ${mode})` });
        onEvent('log', { message: `Targeting ${sniperConfig.length} item(s)` });

        try {
            let currentPayload = {
                characterName: characterId,
                entityBlockedNodeIds: [],
                selectedNodeIds: []
            };

            onEvent('log', { message: 'Sending initial request...' });
            let response = await axios.post(url, currentPayload, { headers, timeout: 15000 });
            let data = response.data;

            if (data.updatedWallets) {
                const bp = data.updatedWallets.find(w => w.currency === 'Bloodpoints')?.balance || 0;
                const bonusBp = data.updatedWallets.find(w => w.currency === 'BonusBloodpoints')?.balance || 0;
                startingBP = bp + bonusBp;
            }

            while (!this.isCancelled) {
                let currentBP = null;
                if (data.updatedWallets) {
                    const bp = data.updatedWallets.find(w => w.currency === 'Bloodpoints')?.balance || 0;
                    const bonusBp = data.updatedWallets.find(w => w.currency === 'BonusBloodpoints')?.balance || 0;
                    currentBP = bp + bonusBp;
                }

                if (currentBP !== null && startingBP !== null) {
                    onEvent('stats', {
                        bloodpointsSpent: startingBP - currentBP,
                        startingBalance: startingBP,
                        currentBalance: currentBP
                    });
                }

                let entityBlockedNodeIds = [];
                let selectedNodeIds = [];

                if (data.bloodWebLevel === 51) {
                    onEvent('log', { message: 'Bloodweb level 51 reached — resetting without prestige' });
                    entityBlockedNodeIds = ["0"];
                    selectedNodeIds = [];
                } else {
                    let targetNodeId = null;
                    let snipedItemName = null;

                    if (data.bloodWebData && data.bloodWebData.ringData) {
                        for (const ring of data.bloodWebData.ringData) {
                            if (ring.nodeData) {
                                for (const node of ring.nodeData) {
                                    if (sniperConfig.includes(node.contentId) && node.state === "Available") {
                                        targetNodeId = node.nodeId;
                                        snipedItemName = contentNameMap.get(node.contentId) || node.contentId;
                                        break;
                                    }
                                }
                            }
                            if (targetNodeId) break;
                        }
                    }

                    if (targetNodeId) {
                        const paths = data.bloodWebData.paths;
                        const pathResult = findPath("0", targetNodeId, paths);

                        if (pathResult) {
                            if (mode === 'skip') {
                                // Snipe & Skip: only select the target node itself
                                selectedNodeIds = [targetNodeId];
                            } else {
                                // Snipe & Collect: select the full path (collects items along the way)
                                selectedNodeIds = pathResult;
                            }

                            onEvent('log', { message: `Sniped: ${snipedItemName}` });
                            snipedItemsSummary[snipedItemName] = (snipedItemsSummary[snipedItemName] || 0) + 1;
                            onEvent('snipedItem', { name: snipedItemName, total: snipedItemsSummary[snipedItemName] });
                        } else {
                            onEvent('log', { message: `Found ${snipedItemName} but no path. Skipping bloodweb.` });
                        }
                    }

                    if (selectedNodeIds.length === 0) {
                        onEvent('log', { message: 'No target found — skipping bloodweb' });
                        entityBlockedNodeIds = ["0"];
                        selectedNodeIds = [];
                    } else {
                        if (data.bloodWebData && data.bloodWebData.ringData) {
                            data.bloodWebData.ringData.forEach(ring => {
                                if (ring.nodeData) {
                                    ring.nodeData.forEach(node => {
                                        if (node.nodeId && !selectedNodeIds.includes(node.nodeId) && node.state === "Available") {
                                            entityBlockedNodeIds.push(node.nodeId);
                                        }
                                    });
                                }
                            });
                        }
                    }
                }

                bloodwebsProcessed++;
                onEvent('log', { message: `Bloodweb #${bloodwebsProcessed} | Level ${data.bloodWebLevel}` });

                currentPayload = {
                    characterName: characterId,
                    entityBlockedNodeIds,
                    selectedNodeIds
                };

                await new Promise(resolve => setTimeout(resolve, 500));

                let retries = 0;
                const maxRetries = 3;
                while (true) {
                    try {
                        response = await axios.post(url, currentPayload, { headers, timeout: 15000 });
                        data = response.data;
                        break;
                    } catch (reqErr) {
                        const status = reqErr.response?.status;
                        const isRetryable = !status || status === 408 || status === 429 || status >= 500;

                        if (isRetryable && retries < maxRetries) {
                            retries++;
                            const delay = 1000 * retries;
                            onEvent('log', { message: `Request failed (${status || 'timeout'}), retrying in ${delay / 1000}s... (${retries}/${maxRetries})` });
                            await new Promise(resolve => setTimeout(resolve, delay));
                        } else {
                            throw reqErr;
                        }
                    }
                }
            }

            onEvent('log', { message: 'Farming stopped by user.' });
            this.isRunning = false;
            return { snipedItems: snipedItemsSummary, bloodwebsProcessed };

        } catch (error) {
            const status = error.response?.status;
            let errorMsg = error.message;
            if (status === 400) {
                errorMsg = 'Likely out of Bloodpoints (400).';
            } else if (status === 408) {
                errorMsg = 'Server timeout (408). Try again.';
            } else if (status === 429) {
                errorMsg = 'Rate limited (429). Wait a moment and try again.';
            } else if (status) {
                errorMsg = `Server error (${status}).`;
            }
            onEvent('log', { message: `Farm error: ${errorMsg}` });
            this.isRunning = false;
            return { snipedItems: snipedItemsSummary, bloodwebsProcessed, error: errorMsg };
        }
    }
}

module.exports = FarmEngine;
