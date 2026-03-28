const axios = require('axios');
const { findPath } = require('./pathfinding');
const { getApiConfig } = require('./api-config');

class PrestigeEngine {
    constructor() {
        this.isCancelled = false;
        this.isRunning = false;
    }

    cancel() {
        this.isCancelled = true;
    }

    async run({ bhvrSession, characterId, prestigeCount, platform, sniperConfig, contentNameMap }, onEvent) {
        if (this.isRunning) {
            onEvent('log', { message: 'Error: A prestige is already running.' });
            return { prestigesDone: 0, totalTarget: 0, snipedItems: {}, error: 'Already running' };
        }
        this.isCancelled = false;
        this.isRunning = true;

        const { url, headers } = getApiConfig(platform, bhvrSession);

        const targetPrestiges = Math.min(Math.max(parseInt(prestigeCount) || 1, 1), 100);
        const sniper = sniperConfig || [];

        onEvent('log', { message: `Starting Prestige for ID: ${characterId} - ${targetPrestiges} prestige(s)` });

        const snipedItemsSummary = {};
        let prestigesDone = 0;

        try {
            let currentPayload = {
                characterName: characterId,
                entityBlockedNodeIds: [],
                selectedNodeIds: []
            };

            onEvent('log', { message: 'Sending initial request...' });
            let response = await axios.post(url, currentPayload, { headers, timeout: 15000 });
            let data = response.data;

            while (prestigesDone < targetPrestiges) {
                if (this.isCancelled) {
                    onEvent('log', { message: 'Process cancelled by user.' });
                    break;
                }

                let totalBloodpoints = null;
                if (data.updatedWallets) {
                    const bp = data.updatedWallets.find(w => w.currency === 'Bloodpoints')?.balance || 0;
                    const bonusBp = data.updatedWallets.find(w => w.currency === 'BonusBloodpoints')?.balance || 0;
                    totalBloodpoints = bp + bonusBp;
                }

                const progressData = {
                    prestigesDone: prestigesDone + 1,
                    totalTarget: targetPrestiges,
                    bloodWebLevel: data.bloodWebLevel,
                    prestigeLevel: data.prestigeLevel
                };

                onEvent('log', {
                    message: `Prestige ${prestigesDone + 1}/${targetPrestiges} - P:${data.prestigeLevel} | Level ${data.bloodWebLevel}/50`
                });

                if (totalBloodpoints !== null) {
                    onEvent('bloodpoints', { value: totalBloodpoints });
                }

                onEvent('progress', progressData);

                await new Promise(resolve => setTimeout(resolve, 500));

                let entityBlockedNodeIds = [];
                let selectedNodeIds = [];

                if (data.bloodWebLevel === 51) {
                    onEvent('log', { message: `Prestige Up! (${prestigesDone + 1}/${targetPrestiges}) - 20K BP` });
                    selectedNodeIds = ["0"];
                    entityBlockedNodeIds = [];
                    prestigesDone++;
                } else {
                    let targetNodeId = null;
                    let snipedItemName = null;

                    if (sniper.length > 0 && data.bloodWebData && data.bloodWebData.ringData) {
                        for (const ring of data.bloodWebData.ringData) {
                            if (ring.nodeData) {
                                for (const node of ring.nodeData) {
                                    if (sniper.includes(node.contentId) && node.state === "Available") {
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
                            selectedNodeIds = pathResult;
                            onEvent('log', { message: `Target Item Sniped: ${snipedItemName}` });
                            if (snipedItemName) {
                                snipedItemsSummary[snipedItemName] = (snipedItemsSummary[snipedItemName] || 0) + 1;
                            }
                        } else {
                            onEvent('log', { message: `Found ${snipedItemName} but no path available. Skipping.` });
                        }
                    }

                    if (selectedNodeIds.length === 0) {
                        if (data.bloodWebData && data.bloodWebData.ringData) {
                            data.bloodWebData.ringData.forEach(ring => {
                                if (ring.nodeData) {
                                    ring.nodeData.forEach(node => {
                                        if (node.nodeId) entityBlockedNodeIds.push(node.nodeId);
                                    });
                                }
                            });
                        }
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

                if (entityBlockedNodeIds.length === 0 && selectedNodeIds.length === 0) {
                    onEvent('log', { message: 'Warning: No nodes found to process. Stopping.' });
                    break;
                }

                currentPayload = {
                    characterName: characterId,
                    entityBlockedNodeIds,
                    selectedNodeIds
                };

                // Send request with retry for transient errors
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

            onEvent('summary', { snipedItems: snipedItemsSummary });
            onEvent('log', { message: `Prestige completed successfully. ${prestigesDone}/${targetPrestiges} prestiges done.` });

            this.isRunning = false;
            return { prestigesDone, totalTarget: targetPrestiges, snipedItems: snipedItemsSummary };

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
            onEvent('log', { message: `Error: ${errorMsg}` });
            this.isRunning = false;
            return { prestigesDone, totalTarget: targetPrestiges, snipedItems: snipedItemsSummary || {}, error: errorMsg };
        }
    }
}

module.exports = PrestigeEngine;
