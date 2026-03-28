const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const zlib = require('zlib');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Store certs in user's app data, not inside the app directory (ASAR can't be written to)
const CERT_DIR = path.join(require('os').homedir(), '.prestiger', 'certs');
const PROXY_PORT = 8888;

const INTERCEPT_HOSTS = new Set([
    'steam.live.bhvrdbd.com',
    'egs.live.bhvrdbd.com',
    'grdk.live.bhvrdbd.com',
    'gamelogs.live.bhvrdbd.com',
]);

const HOST_PLATFORM = {
    'steam.live.bhvrdbd.com': 'steam',
    'egs.live.bhvrdbd.com': 'egs',
    'grdk.live.bhvrdbd.com': 'ms_store',
};

class MitmProxy {
    constructor() {
        this.ca = null;
        this.certCache = new Map();
        this.server = null;
        this.mitmHttpServer = null;
        this.capturedCookies = new Map();
        this.onCookieCaptured = null;
        this.proxyRunning = false;
        this.systemProxyEnabled = false;
        // Unlock interception
        this.unlockConfig = null;
        this.interceptEnabled = false;
        this.cachedInventoryResponse = null;
        this.userId = null;
        this.profileGenerator = null;
        this.onRequestLog = null; // callback(entry) for debug logging
        this.savedPlayerCard = null; // persisted player card preset (badges/banners)
        this._loadPlayerCard();
        this.savedProxyEnable = null;
        this.savedProxyServer = null;
        // Tomes auto-completion
        this.tomeCompleter = null;
        this.playerRole = null; // 'survivor' | 'killer' | null
        this.isInMatch = false;
    }

    // ── Certificate Management ──

    ensureCertDir() {
        if (!fs.existsSync(CERT_DIR)) {
            fs.mkdirSync(CERT_DIR, { recursive: true });
        }
    }

    loadOrGenerateCA() {
        this.ensureCertDir();
        const certPath = path.join(CERT_DIR, 'ca.crt');
        const keyPath = path.join(CERT_DIR, 'ca.key');

        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
            const certPem = fs.readFileSync(certPath, 'utf8');
            const keyPem = fs.readFileSync(keyPath, 'utf8');
            this.ca = {
                cert: certPem,
                key: keyPem,
                forgeCert: forge.pki.certificateFromPem(certPem),
                forgeKey: forge.pki.privateKeyFromPem(keyPem),
            };
            console.log('Loaded existing CA certificate.');
            return;
        }

        console.log('Generating new CA certificate (first run)...');
        const keys = forge.pki.rsa.generateKeyPair(2048);
        const cert = forge.pki.createCertificate();

        cert.publicKey = keys.publicKey;
        cert.serialNumber = '01';
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 10);

        const attrs = [
            { name: 'commonName', value: 'prestiger' },
            { name: 'organizationName', value: 'prestiger' },
        ];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.setExtensions([
            { name: 'basicConstraints', cA: true },
            { name: 'keyUsage', keyCertSign: true, cRLSign: true },
        ]);
        cert.sign(keys.privateKey, forge.md.sha256.create());

        const certPem = forge.pki.certificateToPem(cert);
        const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
        fs.writeFileSync(certPath, certPem);
        fs.writeFileSync(keyPath, keyPem);

        this.ca = { cert: certPem, key: keyPem, forgeCert: cert, forgeKey: keys.privateKey };
        console.log(`CA certificate generated and saved to ${CERT_DIR}`);
    }

    generateDomainCert(domain) {
        if (this.certCache.has(domain)) return this.certCache.get(domain);

        const keys = forge.pki.rsa.generateKeyPair(2048);
        const cert = forge.pki.createCertificate();

        cert.publicKey = keys.publicKey;
        cert.serialNumber = Date.now().toString(16);
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

        cert.setSubject([{ name: 'commonName', value: domain }]);
        cert.setIssuer(this.ca.forgeCert.subject.attributes);
        cert.setExtensions([
            { name: 'subjectAltName', altNames: [{ type: 2, value: domain }] },
        ]);
        cert.sign(this.ca.forgeKey, forge.md.sha256.create());

        const result = {
            cert: forge.pki.certificateToPem(cert),
            key: forge.pki.privateKeyToPem(keys.privateKey),
        };
        this.certCache.set(domain, result);
        return result;
    }

    getCACertPath() {
        return path.join(CERT_DIR, 'ca.crt');
    }

    // ── Cookie Extraction ──

    extractCookie(headers) {
        const cookieHeader = headers['cookie'] || '';
        const match = cookieHeader.match(/bhvrSession=([^;]+)/);
        return match ? match[1] : null;
    }

    // ── Unlock Interception ──

    setProfileGenerator(generator) {
        this.profileGenerator = generator;
    }

    setUnlockConfig(config) {
        this.unlockConfig = config;
        this.interceptEnabled = config && config.enabled;
        if (this.profileGenerator && this.userId) {
            this.profileGenerator.setUserId(this.userId);
        }
    }

    setTomeCompleter(tomeCompleter) {
        this.tomeCompleter = tomeCompleter;
    }

    getUnlockConfig() {
        return this.unlockConfig;
    }

    _shouldIntercept(url, host, headers) {
        if (!this.interceptEnabled || !this.unlockConfig) return null;
        // Never intercept our own engine requests (prestige/farm/tomes)
        if (headers && headers['x-prestiger-internal']) return null;

        const cfg = this.unlockConfig;

        // Block gamelogs entirely
        if (cfg.blockGamelogs && cfg.blockGamelogs.enabled) {
            if (host === 'gamelogs.live.bhvrdbd.com') return 'blockGamelogs';
        }

        if (!this.profileGenerator) return null;

        if (cfg.characters && cfg.characters.enabled) {
            if (url.includes('/api/v1/dbd-character-data/get-all')) return 'getAll';
            // bloodweb is snooped (not intercepted) — requests must reach the server
            // so node purchases get processed. We modify the response afterwards.
        }
        // Note: dbd-inventories/all is handled via response modification in snooping, not here
        if (cfg.currency && cfg.currency.enabled) {
            if (url.includes('/api/v1/wallet/currencies')) return 'currency';
        }
        if (cfg.level && cfg.level.enabled) {
            if (url.includes('/api/v1/extensions/playerLevels/')) return 'level';
        }
        if (cfg.killswitch && cfg.killswitch.enabled) {
            if (url.includes('/itemsKillswitch.json')) return 'killswitch';
        }
        if (cfg.tutorials && cfg.tutorials.enabled) {
            if (url.includes('/v1/onboarding/get-bot-match-status')) return 'tutorialStatus';
            if (url.includes('/v1/onboarding')) return 'tutorialOnboarding';
        }
        // Player card (badges/banners) — always active when unlock is enabled
        if (url.includes('/api/v1/dbd-player-card')) {
            if (url.endsWith('/set')) return 'playerCardSet';
            if (url.endsWith('/get') && this.savedPlayerCard) return 'playerCardGet';
        }

        return null;
    }

    _generateResponse(interceptType, reqBodyStr) {
        const cfg = this.unlockConfig;
        switch (interceptType) {
            case 'getAll': return this.profileGenerator.generateGetAll(cfg);
            case 'currency': return this.profileGenerator.generateCurrency(cfg);
            case 'level': return this.profileGenerator.generatePlayerLevel(cfg);
            case 'killswitch': return this.profileGenerator.generateKillswitch();
            case 'tutorialStatus': return { survivorMatchPlayed: true, killerMatchPlayed: true };
            case 'tutorialOnboarding': return this.profileGenerator.generateOnboarding();
            case 'blockGamelogs': return {};
            case 'playerCardSet': {
                // Save the card data (badges/banners) and echo it back
                if (reqBodyStr) {
                    try {
                        const cardData = JSON.parse(reqBodyStr);
                        this._savePlayerCard(cardData);
                        console.log('[Proxy] Saved player card preset (badges/banners)');
                        return cardData;
                    } catch (_) {}
                }
                return {};
            }
            case 'playerCardGet':
                // Return saved card preset
                return this.savedPlayerCard;
            default: return null;
        }
    }

    // ── Player Card Persistence (badges/banners) ──

    _loadPlayerCard() {
        try {
            const cardPath = path.join(require('os').homedir(), '.prestiger', 'player-card.json');
            if (fs.existsSync(cardPath)) {
                this.savedPlayerCard = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
            }
        } catch (_) {}
    }

    _savePlayerCard(cardData) {
        this.savedPlayerCard = cardData;
        try {
            const dir = path.join(require('os').homedir(), '.prestiger');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'player-card.json'), JSON.stringify(cardData));
        } catch (_) {}
    }

    _shouldSnoop(url) {
        if (url.includes('/api/v1/auth/provider/')) return 'auth';
        if (url.includes('/api/v1/dbd-inventories/all')) return 'inventories';
        if (url.includes('/api/v1/dbd-character-data/bloodweb')) return 'bloodweb';
        if (url.includes('/api/v1/match')) return 'match';
        if (url.includes('/api/v1/gameDataAnalytics/v2/batch')) return 'analytics';
        return null;
    }

    _decompressBody(buffer, encoding) {
        return new Promise((resolve, reject) => {
            if (!encoding) {
                resolve(buffer);
            } else if (encoding === 'gzip') {
                zlib.gunzip(buffer, (err, result) => err ? reject(err) : resolve(result));
            } else if (encoding === 'deflate') {
                zlib.inflate(buffer, (err, result) => err ? reject(err) : resolve(result));
            } else {
                resolve(buffer);
            }
        });
    }

    _emitRequestLog(method, host, url, status, size, intercepted, snooped, requestBody, responseBody) {
        if (!this.onRequestLog) return;
        this.onRequestLog({
            timestamp: Date.now(),
            method: method || 'GET',
            host,
            path: url,
            status: status || 0,
            size: size || 0,
            intercepted: intercepted || null,
            snooped: snooped || null,
            requestBody: requestBody || null,
            responseBody: responseBody || null,
        });
    }



    // ── MITM Request Handler ──

    handleMitmRequest(req, res, host) {
        const cookie = this.extractCookie(req.headers);
        if (cookie) {
            const platform = HOST_PLATFORM[host] || 'unknown';
            const existing = this.capturedCookies.get(platform);
            const isNew = !existing || existing.value !== cookie;

            this.capturedCookies.set(platform, {
                value: cookie,
                domain: host,
                platform,
                capturedAt: Date.now(),
            });

            if (isNew) {
                console.log(`[Proxy] Captured bhvrSession from ${host} (${platform})`);
                if (this.onCookieCaptured) {
                    this.onCookieCaptured(platform, cookie);
                }
            }
        }

        // Capture game headers for tomes (needed for API calls)
        if (this.tomeCompleter && req.headers['api-key']) {
            this.tomeCompleter.captureHeaders(req.headers, host);
        }

        // Buffer request body for debug logging
        const reqChunks = [];
        req.on('data', chunk => reqChunks.push(chunk));
        req.on('end', () => {
            const reqBody = Buffer.concat(reqChunks);
            let reqBodyStr = null;
            try { reqBodyStr = reqBody.length > 0 ? reqBody.toString('utf8').slice(0, 50000) : null; } catch (_) {}

            // Check if we should intercept this endpoint
            const interceptType = this._shouldIntercept(req.url, host, req.headers);
            if (interceptType) {
                const body = this._generateResponse(interceptType, reqBodyStr);
                if (body) {
                    // Handle raw buffer responses (e.g. Catalog.json is BHVR binary format)
                    if (body.__rawBuffer) {
                        const buf = body.__rawBuffer;
                        console.log(`[Proxy] Intercepted ${req.url} → ${interceptType} (raw ${buf.length} bytes)`);
                        this._emitRequestLog(req.method, host, req.url, 200, buf.length, interceptType, null, reqBodyStr, `[Binary ${buf.length} bytes]`);
                        res.writeHead(200, {
                            'Content-Type': 'application/octet-stream',
                            'Content-Length': buf.length,
                        });
                        res.end(buf);
                        return;
                    }

                    const json = JSON.stringify(body);
                    const resPreview = json.slice(0, 50000);
                    console.log(`[Proxy] Intercepted ${req.url} → ${interceptType}`);
                    this._emitRequestLog(req.method, host, req.url, 200, Buffer.byteLength(json), interceptType, null, reqBodyStr, resPreview);
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(json),
                    });
                    res.end(json);
                    return;
                }
            }

            // Forward request to real server
            const options = {
                hostname: host,
                port: 443,
                path: req.url,
                method: req.method,
                headers: { ...req.headers, host },
            };

            const snoopType = this._shouldSnoop(req.url);

            const proxyReq = https.request(options, (proxyRes) => {
                // Always buffer response for debug logging
                const resChunks = [];
                proxyRes.on('data', chunk => resChunks.push(chunk));
                proxyRes.on('end', async () => {
                    let buffer = Buffer.concat(resChunks);
                    let modified = false;

                    // Process snooped responses BEFORE forwarding
                    if (snoopType) {
                        try {
                            const encoding = proxyRes.headers['content-encoding'];
                            const decompressed = await this._decompressBody(buffer, encoding);
                            const data = JSON.parse(decompressed.toString('utf8'));

                            if (snoopType === 'auth' && data.userId) {
                                this.userId = data.userId;
                                if (this.profileGenerator) {
                                    this.profileGenerator.setUserId(data.userId);
                                }
                                console.log(`[Proxy] Extracted userId: ${data.userId}`);
                            } else if (snoopType === 'inventories' && data.inventoryItems) {
                                // Merge live cosmetics for caching
                                if (this.profileGenerator) {
                                    this.profileGenerator.mergeLiveCosmetics(data.inventoryItems);
                                }

                                // Inject items/addons/offerings/perks into the real response
                                if (this.interceptEnabled && this.unlockConfig && this.profileGenerator) {
                                    const populated = this.profileGenerator.populateInventory(data, this.unlockConfig);
                                    const modifiedJson = JSON.stringify(populated);
                                    buffer = Buffer.from(modifiedJson);
                                    modified = true;
                                    console.log(`[Proxy] Populated inventory with items/addons/offerings (${populated.inventoryItems.length} total)`);
                                }
                            } else if (snoopType === 'bloodweb') {
                                // Modify bloodweb response: inject characterItems and set prestige.
                                // Like Cursed Market: let the request reach the server (so node
                                // purchases get processed), then modify the response.
                                // If server returned an error (unowned character), generate our own.
                                if (this.interceptEnabled && this.unlockConfig && this.unlockConfig.characters && this.unlockConfig.characters.enabled && this.profileGenerator) {
                                    let bwData;
                                    if (proxyRes.statusCode === 200) {
                                        // Server returned success — modify the real response
                                        bwData = data;
                                    } else {
                                        // Server returned error (e.g. unowned character) —
                                        // generate our own response from template
                                        bwData = this.profileGenerator.generateBloodweb(this.unlockConfig);
                                    }
                                    const modifiedBw = this.profileGenerator.populateBloodweb(bwData, reqBodyStr, this.unlockConfig);
                                    const modifiedJson = JSON.stringify(modifiedBw);
                                    buffer = Buffer.from(modifiedJson);
                                    modified = true;
                                    // Force 200 status for error responses
                                    if (proxyRes.statusCode !== 200) {
                                        proxyRes.statusCode = 200;
                                    }
                                    console.log(`[Proxy] Modified bloodweb for ${modifiedBw.characterName} (P${modifiedBw.prestigeLevel})`);
                                }
                            } else if (snoopType === 'match' && !this.isInMatch) {
                                // Detect match entry and player role (like Cursed Market)
                                // The /api/v1/match response contains sideA (killers) and sideB (survivors)
                                try {
                                    const matchUrl = req.url;
                                    const matchIdMatch = matchUrl.match(/match\/([a-f0-9-]+)$/);
                                    if (matchIdMatch && this.userId) {
                                        this.isInMatch = true;
                                        // Determine role from sideA/sideB
                                        if (data.sideA && Array.isArray(data.sideA)) {
                                            const inSideA = data.sideA.some(p => p.odCloudId === this.userId || p.odPlayerId === this.userId);
                                            this.playerRole = inSideA ? 'killer' : 'survivor';
                                        }
                                        console.log(`[Proxy] Match detected, role: ${this.playerRole}`);
                                    }
                                } catch (_) {}
                            } else if (snoopType === 'analytics' && this.tomeCompleter && this.tomeCompleter.enabled) {
                                // Detect match end from analytics batch — extract match IDs for tome completion
                                try {
                                    // Analytics can be an object with events or just raw data
                                    const events = data.events || (Array.isArray(data) ? data : [data]);
                                    let matchId = null;
                                    let krakenMatchId = null;

                                    for (const evt of events) {
                                        if (evt.match_id) matchId = evt.match_id;
                                        if (evt.kraken_match_id) krakenMatchId = evt.kraken_match_id;
                                        if (evt.matchId) matchId = evt.matchId;
                                        if (evt.krakenMatchId) krakenMatchId = evt.krakenMatchId;
                                    }

                                    // Also check reqBody for match IDs
                                    if ((!matchId || !krakenMatchId) && reqBodyStr) {
                                        try {
                                            const reqData = JSON.parse(reqBodyStr);
                                            const reqEvents = reqData.events || (Array.isArray(reqData) ? reqData : [reqData]);
                                            for (const evt of reqEvents) {
                                                if (evt.match_id && !matchId) matchId = evt.match_id;
                                                if (evt.kraken_match_id && !krakenMatchId) krakenMatchId = evt.kraken_match_id;
                                                if (evt.matchId && !matchId) matchId = evt.matchId;
                                                if (evt.krakenMatchId && !krakenMatchId) krakenMatchId = evt.krakenMatchId;
                                            }
                                        } catch (_) {}
                                    }

                                    if (matchId && krakenMatchId && this.isInMatch) {
                                        this.isInMatch = false;
                                        const role = this.playerRole || 'survivor';
                                        console.log(`[Tomes] Match ended, completing quest (role: ${role})`);
                                        this.tomeCompleter.completeActiveQuest(
                                            { matchId, krakenMatchId },
                                            role
                                        ).catch(err => console.error(`[Tomes] Error: ${err.message}`));
                                        this.playerRole = null;
                                    }
                                } catch (_) {}
                            }
                        } catch (parseErr) {
                            // If bloodweb response couldn't be parsed (server error),
                            // generate our own response so unowned characters still work
                            if (snoopType === 'bloodweb' && this.interceptEnabled && this.unlockConfig &&
                                this.unlockConfig.characters && this.unlockConfig.characters.enabled && this.profileGenerator) {
                                try {
                                    const bwTemplate = this.profileGenerator.generateBloodweb(this.unlockConfig);
                                    const modifiedBw = this.profileGenerator.populateBloodweb(bwTemplate, reqBodyStr, this.unlockConfig);
                                    const modifiedJson = JSON.stringify(modifiedBw);
                                    buffer = Buffer.from(modifiedJson);
                                    modified = true;
                                    proxyRes.statusCode = 200;
                                    console.log(`[Proxy] Generated bloodweb fallback for ${modifiedBw.characterName}`);
                                } catch (fallbackErr) {
                                    console.error(`[Proxy] Bloodweb fallback error: ${fallbackErr.message}`);
                                }
                            } else {
                                console.error(`[Proxy] Snoop parse error: ${parseErr.message}`);
                            }
                        }
                    }

                    // Forward response (modified or original)
                    if (modified) {
                        const headers = { ...proxyRes.headers };
                        delete headers['content-encoding'];
                        delete headers['content-length'];
                        res.writeHead(proxyRes.statusCode, headers);
                        res.end(buffer);
                    } else {
                        res.writeHead(proxyRes.statusCode, proxyRes.headers);
                        res.end(buffer);
                    }

                    // Debug preview
                    let resBodyStr = null;
                    try {
                        if (modified) {
                            resBodyStr = buffer.toString('utf8').slice(0, 50000);
                        } else {
                            const encoding = proxyRes.headers['content-encoding'];
                            const decompressed = await this._decompressBody(buffer, encoding);
                            resBodyStr = decompressed.toString('utf8').slice(0, 50000);
                        }
                    } catch (_) {
                        resBodyStr = `[Binary ${buffer.length} bytes]`;
                    }

                    this._emitRequestLog(req.method, host, req.url, proxyRes.statusCode, buffer.length, modified ? 'inventories' : null, snoopType, reqBodyStr, resBodyStr);
                });
            });

            proxyReq.on('error', (err) => {
                console.error(`[Proxy] Forward error ${host}${req.url}: ${err.message}`);
                try {
                    res.writeHead(502);
                    res.end('Bad Gateway');
                } catch (_) {}
            });

            // Write the buffered request body and end
            if (reqBody.length > 0) {
                proxyReq.write(reqBody);
            }
            proxyReq.end();
        });
    }

    // ── Proxy Server ──

    start() {
        if (this.proxyRunning) return;
        this.loadOrGenerateCA();

        // Shared HTTP server for MITM'd TLS connections
        this.mitmHttpServer = http.createServer((req, res) => {
            const host = req.headers.host?.split(':')[0];
            if (host) {
                this.handleMitmRequest(req, res, host);
            } else {
                res.writeHead(400);
                res.end();
            }
        });

        // Main proxy server
        this.server = http.createServer((req, res) => {
            // Plain HTTP proxy pass-through
            const parsed = new URL(req.url);
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || 80,
                path: parsed.pathname + parsed.search,
                method: req.method,
                headers: req.headers,
            };
            const proxyReq = http.request(options, (proxyRes) => {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res);
            });
            proxyReq.on('error', () => {
                try { res.writeHead(502); res.end(); } catch (_) {}
            });
            req.pipe(proxyReq);
        });

        this.server.on('connect', (req, clientSocket, head) => {
            const [host, portStr] = req.url.split(':');
            const port = parseInt(portStr) || 443;

            if (INTERCEPT_HOSTS.has(host)) {
                // MITM: respond 200 then wrap with TLS using our fake cert
                const domainCert = this.generateDomainCert(host);

                clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

                if (head && head.length > 0) {
                    clientSocket.unshift(head);
                }

                const tlsSocket = new tls.TLSSocket(clientSocket, {
                    isServer: true,
                    key: domainCert.key,
                    cert: domainCert.cert,
                });

                tlsSocket.on('error', (err) => {
                    if (err.code !== 'ECONNRESET') {
                        console.error(`[Proxy] TLS error for ${host}: ${err.message}`);
                    }
                });

                this.mitmHttpServer.emit('connection', tlsSocket);
            } else {
                // Non-BHVR: fast raw TCP tunnel with no buffering
                const serverSocket = net.connect({ port, host, noDelay: true }, () => {
                    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                    if (head && head.length > 0) {
                        serverSocket.write(head);
                    }
                    serverSocket.pipe(clientSocket);
                    clientSocket.pipe(serverSocket);
                });

                clientSocket.setNoDelay(true);
                serverSocket.on('error', () => { try { clientSocket.destroy(); } catch (_) {} });
                clientSocket.on('error', () => { try { serverSocket.destroy(); } catch (_) {} });
            }
        });

        this.server.on('error', (e) => {
            if (e.code === 'EADDRINUSE') {
                console.error(`[Proxy] Port ${PROXY_PORT} already in use.`);
            } else {
                console.error('[Proxy] Server error:', e.message);
            }
        });

        this.server.listen(PROXY_PORT, () => {
            this.proxyRunning = true;
            console.log(`[Proxy] MITM proxy running on port ${PROXY_PORT}`);
        });
    }

    stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        if (this.mitmHttpServer) {
            this.mitmHttpServer.close();
            this.mitmHttpServer = null;
        }
        this.proxyRunning = false;
    }

    // ── System Proxy ──

    // Bypass list — these domains skip the proxy entirely (direct connection)
    // Only BHVR domains (*.bhvrdbd.com) and unknown domains go through the proxy
    static PROXY_BYPASS = [
        '*.discord.com', '*.discordapp.com', '*.discord.gg', '*.discordapp.net',
        '*.steampowered.com', '*.steamcommunity.com', '*.steamgames.com',
        '*.valve.net', '*.valvesoftware.com', '*.steamserver.net', '*.steamcontent.com',
        '*.google.com', '*.googleapis.com', '*.gstatic.com', '*.youtube.com',
        '*.microsoft.com', '*.windowsupdate.com', '*.live.com', '*.office.com',
        '*.github.com', '*.githubusercontent.com',
        '*.cloudflare.com', '*.cloudfront.net', '*.akamai.net', '*.akamaized.net',
        '*.amazonaws.com', '*.azure.com',
        '*.twitch.tv', '*.twitchcdn.net', '*.jtvnw.net',
        '*.reddit.com', '*.redditmedia.com',
        '*.twitter.com', '*.x.com',
        '*.epicgames.com', '*.unrealengine.com',
        '*.xbox.com', '*.xboxlive.com',
        'localhost', '127.0.0.1', '<local>',
    ].join(';');

    saveCurrentProxySettings() {
        try {
            const result = execSync(
                'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable',
                { encoding: 'utf8', windowsHide: true }
            );
            this.savedProxyEnable = result.includes('0x1') ? 1 : 0;
        } catch (_) {
            this.savedProxyEnable = 0;
        }

        try {
            const result = execSync(
                'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
                { encoding: 'utf8', windowsHide: true }
            );
            const match = result.match(/ProxyServer\s+REG_SZ\s+(.+)/);
            this.savedProxyServer = match ? match[1].trim() : null;
        } catch (_) {
            this.savedProxyServer = null;
        }
    }

    enableSystemProxy() {
        try {
            this.saveCurrentProxySettings();

            execSync(
                'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f',
                { windowsHide: true }
            );
            execSync(
                `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "127.0.0.1:${PROXY_PORT}" /f`,
                { windowsHide: true }
            );
            execSync(
                `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "${MitmProxy.PROXY_BYPASS}" /f`,
                { windowsHide: true }
            );

            this.notifyProxyChange();
            this.systemProxyEnabled = true;
            console.log('[Proxy] System proxy enabled (127.0.0.1:' + PROXY_PORT + ')');
            return true;
        } catch (err) {
            console.error('[Proxy] Failed to set system proxy:', err.message);
            return false;
        }
    }

    disableSystemProxy() {
        try {
            if (this.savedProxyEnable && this.savedProxyServer) {
                execSync(
                    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d ${this.savedProxyEnable} /f`,
                    { windowsHide: true }
                );
                execSync(
                    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${this.savedProxyServer}" /f`,
                    { windowsHide: true }
                );
            } else {
                execSync(
                    'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f',
                    { windowsHide: true }
                );
            }

            this.notifyProxyChange();
            this.systemProxyEnabled = false;
            console.log('[Proxy] System proxy restored');
            return true;
        } catch (err) {
            console.error('[Proxy] Failed to restore system proxy:', err.message);
            return false;
        }
    }

    notifyProxyChange() {
        try {
            // Write a temp PS1 script to avoid here-string escaping issues
            const tmpFile = path.join(require('os').tmpdir(), 'prestiger_proxy_notify.ps1');
            const script = [
                'Add-Type -TypeDefinition @"',
                'using System;',
                'using System.Runtime.InteropServices;',
                'public class WinInet {',
                '    [DllImport("wininet.dll", SetLastError=true)]',
                '    public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int lpdwBufferLength);',
                '    public const int INTERNET_OPTION_SETTINGS_CHANGED = 39;',
                '    public const int INTERNET_OPTION_REFRESH = 37;',
                '}',
                '"@',
                '[WinInet]::InternetSetOption([IntPtr]::Zero, [WinInet]::INTERNET_OPTION_SETTINGS_CHANGED, [IntPtr]::Zero, 0) | Out-Null',
                '[WinInet]::InternetSetOption([IntPtr]::Zero, [WinInet]::INTERNET_OPTION_REFRESH, [IntPtr]::Zero, 0) | Out-Null',
            ].join('\n');
            fs.writeFileSync(tmpFile, script);
            execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, { windowsHide: true });
            try { fs.unlinkSync(tmpFile); } catch (_) {}
        } catch (_) {}
    }

    // ── CA Certificate Installation ──

    installCACert() {
        const certPath = this.getCACertPath();
        if (!fs.existsSync(certPath)) {
            return { success: false, error: 'CA certificate not found. Start the proxy first.' };
        }
        try {
            // Write cert to temp file since certutil can't read from ASAR archives
            const os = require('os');
            const tmpCert = path.join(os.tmpdir(), 'prestiger_ca.crt');
            fs.writeFileSync(tmpCert, this.ca.cert);
            execSync(`certutil -addstore -user Root "${tmpCert}"`, {
                encoding: 'utf8',
                windowsHide: true,
            });
            try { fs.unlinkSync(tmpCert); } catch (_) {}
            console.log('[Proxy] CA certificate installed to user trust store');
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    getCertHash() {
        if (!this.ca) return null;
        const md = forge.md.sha1.create();
        md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(this.ca.forgeCert)).getBytes());
        return md.digest().toHex();
    }

    removeCACert() {
        if (!this.ca) {
            return { success: false, error: 'No CA certificate loaded.' };
        }
        try {
            const hash = this.getCertHash();
            if (!hash) return { success: false, error: 'Could not compute cert hash.' };
            execSync(`certutil -delstore -user Root "${hash}"`, {
                encoding: 'utf8',
                windowsHide: true,
            });
            console.log('[Proxy] CA certificate removed from user trust store');
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    isCACertInstalled() {
        if (!this.ca) return false;
        try {
            const hash = this.getCertHash();
            if (!hash) return false;
            const result = execSync(
                'certutil -user -store Root',
                { encoding: 'utf8', windowsHide: true }
            );
            // Match against our cert's SHA1 hash (certutil prints it as "Cert Hash(sha1): xx xx xx...")
            return result.includes(hash);
        } catch (_) {
            return false;
        }
    }

    // ── Cleanup ──

    cleanup() {
        // Always force-disable proxy on cleanup, regardless of tracked state
        try {
            execSync(
                'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f',
                { windowsHide: true }
            );
            this.notifyProxyChange();
        } catch (_) {}
        this.systemProxyEnabled = false;
        this.stop();
    }

    // Check for stale proxy settings left from a previous crash
    static cleanupStaleProxy() {
        try {
            const result = execSync(
                'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
                { encoding: 'utf8', windowsHide: true }
            );
            if (result.includes(`127.0.0.1:${PROXY_PORT}`)) {
                const enableResult = execSync(
                    'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable',
                    { encoding: 'utf8', windowsHide: true }
                );
                if (enableResult.includes('0x1')) {
                    console.log('[Proxy] Found stale proxy settings from previous session, cleaning up...');
                    execSync(
                        'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f',
                        { windowsHide: true }
                    );
                }
            }
        } catch (_) {}
    }

    // ── State ──

    getCapturedCookies() {
        return Array.from(this.capturedCookies.values());
    }

    clearCapturedCookies() {
        this.capturedCookies.clear();
    }

    getStatus() {
        return {
            running: this.proxyRunning,
            port: PROXY_PORT,
            certInstalled: this.isCACertInstalled(),
            capturedCookies: this.getCapturedCookies(),
        };
    }
}

module.exports = MitmProxy;
