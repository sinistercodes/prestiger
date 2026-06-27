const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const axios = require('axios');
const MitmProxy = require('./src/tools/proxy');
const PrestigeEngine = require('./src/prestige-engine');
const FarmEngine = require('./src/farm-engine');
const ProfileGenerator = require('./src/profile-generator');
const { SURVIVORS, KILLERS, loadGameData } = require('./src/data');
const { findBhvrCookies } = require('./src/tools/cookieExtractor');
const { detectPlatform } = require('./src/tools/platformDetector');
const { PLATFORM_CONFIG } = require('./src/api-config');

// Look up the BHVR host the engines should hit for a given platform key.
// Used to pull the matching proxy-captured headers before each engine run.
function hostForPlatform(platform) {
    const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.egs;
    return cfg.host;
}

const TomeCompleter = require('./src/tomes');
const { tryClaimWeeklyBox } = require('./src/auto-claim');

// Set of tokens we've already attempted a mystery-box claim for (per session).
// Prevents repeat claims on every cookie re-capture / re-login event.
const autoClaimedTokens = new Set();

const PRESTIGER_DIR = path.join(require('os').homedir(), '.prestiger');
const UNLOCK_CONFIG_PATH = path.join(PRESTIGER_DIR, 'unlock-config.json');
const TOMES_CONFIG_PATH = path.join(PRESTIGER_DIR, 'tomes-config.json');

let mainWindow;
// Clean up any stale proxy settings from a previous crash
MitmProxy.cleanupStaleProxy();

const proxy = new MitmProxy();
const engine = new PrestigeEngine();
const farmEngine = new FarmEngine();
const profileGenerator = new ProfileGenerator(__dirname);
const tomeCompleter = new TomeCompleter();
proxy.setProfileGenerator(profileGenerator);
proxy.setTomeCompleter(tomeCompleter);

try {
    if (require('fs').existsSync(UNLOCK_CONFIG_PATH)) {
        const saved = JSON.parse(require('fs').readFileSync(UNLOCK_CONFIG_PATH, 'utf8'));
        proxy.setUnlockConfig(saved);
    }
} catch (_) {}

try {
    if (require('fs').existsSync(TOMES_CONFIG_PATH)) {
        const saved = JSON.parse(require('fs').readFileSync(TOMES_CONFIG_PATH, 'utf8'));
        tomeCompleter.setEnabled(saved.enabled || false);
    }
} catch (_) {}

const { itemsData, addonsData, offeringsData, contentNameMap } = loadGameData(__dirname);

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1052,
        height: 690,
        minWidth: 800,
        minHeight: 500,
        backgroundColor: '#0d0d0d',
        icon: path.join(__dirname, 'src', 'assets', 'icon.ico'),
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: false
        }
    });

    // Forward tome completion events to renderer
    tomeCompleter.onEvent = (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tome-event', event);
        }
    };

    // In dev, load from Vite dev server; in production, load built files
    const isDev = !app.isPackaged;
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'));
    }

    // Block devtools shortcuts and right-click inspect
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12') event.preventDefault();
        if (input.control && input.shift && (input.key === 'I' || input.key === 'i')) event.preventDefault();
        if (input.control && input.shift && (input.key === 'J' || input.key === 'j')) event.preventDefault();
        if (input.control && (input.key === 'U' || input.key === 'u')) event.preventDefault();
    });

    // Open external links in the default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Load CA cert on startup (needed for install/status checks before proxy starts)
    proxy.loadOrGenerateCA();

    proxy.onCookieCaptured = (platform, cookie) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('proxy-cookie-captured', { platform, cookie });
        }
        // Auto-claim the weekly mystery box (free 250k BP) the first time we
        // see a given token. Runs after a short delay so the proxy has time
        // to also capture the corresponding live request headers.
        const key = platform + ':' + cookie;
        if (autoClaimedTokens.has(key)) return;
        autoClaimedTokens.add(key);
        setTimeout(async () => {
            try {
                const headerOverrides = proxy.getCapturedGameHeaders(hostForPlatform(platform));
                const result = await tryClaimWeeklyBox({ apiKey: cookie, platform, headerOverrides });
                const type = result.error ? 'error' : (result.claimed ? 'success' : 'info');
                const message = `[Mystery Box] ${result.message}`;
                console.log(message);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('auto-log', { message, type });
                }
            } catch (err) {
                const message = `[Mystery Box] Auto-claim crashed: ${err.message}`;
                console.error(message);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('auto-log', { message, type: 'error' });
                }
            }
        }, 1500);
    };

    proxy.onRequestLog = (entry) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('proxy-request-log', entry);
        }
    };

}

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    proxy.cleanup();
    app.quit();
});

// Ensure proxy is cleaned up on all exit paths
app.on('before-quit', () => proxy.cleanup());
process.on('SIGINT', () => { proxy.cleanup(); process.exit(0); });
process.on('SIGTERM', () => { proxy.cleanup(); process.exit(0); });
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    proxy.cleanup();
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
});

// ── IPC Handlers ──

ipcMain.handle('get-characters', () => ({
    survivors: SURVIVORS,
    killers: KILLERS
}));

ipcMain.handle('get-items', () => itemsData);
ipcMain.handle('get-addons', () => addonsData);
ipcMain.handle('get-offerings', () => offeringsData);

ipcMain.handle('get-cookie', async () => {
    const proxyCookies = proxy.getCapturedCookies();
    if (proxyCookies.length > 0) {
        return { cookies: proxyCookies, source: 'proxy' };
    }
    try {
        const cookies = await findBhvrCookies();
        return { cookies, source: 'browser' };
    } catch (err) {
        return { cookies: [], source: 'none' };
    }
});

ipcMain.handle('detect-platform', () => detectPlatform());

ipcMain.handle('proxy-get-status', () => proxy.getStatus());
ipcMain.handle('proxy-clear-sessions', () => { proxy.clearCapturedCookies(); return { success: true }; });

ipcMain.handle('proxy-start', () => {
    if (proxy.proxyRunning) return { success: true, message: 'Proxy already running' };
    proxy.start();
    proxy.enableSystemProxy();
    return { success: true, message: 'Proxy started and system proxy enabled' };
});

ipcMain.handle('proxy-stop', () => {
    proxy.disableSystemProxy();
    proxy.stop();
    return { success: true, message: 'Proxy stopped and system proxy restored' };
});

ipcMain.handle('proxy-install-cert', () => proxy.installCACert());
ipcMain.handle('proxy-remove-cert', () => proxy.removeCACert());

// ── Prestige IPC ──

ipcMain.on('start-prestige', async (event, config) => {
    if (farmEngine.isRunning) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('prestige-complete', { prestigesDone: 0, totalTarget: 0, snipedItems: {}, error: 'Farming is running. Stop it first.' });
        }
        return;
    }

    const send = (type, data) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        // 'wire' events carry full request/response payloads — route them
        // straight to the debug log channel so the Debug tab picks them up.
        if (type === 'wire') {
            mainWindow.webContents.send('proxy-request-log', data);
            return;
        }
        mainWindow.webContents.send('prestige-event', { type, ...data });
    };

    // If the proxy has seen the live game recently, pass its headers through
    // so engine requests are byte-for-byte indistinguishable.
    const headerOverrides = proxy.getCapturedGameHeaders(hostForPlatform(config.platform));

    const result = await engine.run(
        { ...config, contentNameMap, headerOverrides },
        (type, data) => {
            send(type, data);
        }
    );

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('prestige-complete', result);
    }
});

ipcMain.on('cancel-prestige', () => {
    engine.cancel();
});

// ── Farm IPC ──

ipcMain.on('start-farm', async (event, config) => {
    if (engine.isRunning) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('farm-complete', { snipedItems: {}, bloodwebsProcessed: 0, error: 'Prestige is running. Stop it first.' });
        }
        return;
    }

    const send = (type, data) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (type === 'wire') {
            mainWindow.webContents.send('proxy-request-log', data);
            return;
        }
        mainWindow.webContents.send('farm-event', { type, ...data });
    };

    const headerOverrides = proxy.getCapturedGameHeaders(hostForPlatform(config.platform));

    const result = await farmEngine.run(
        { ...config, contentNameMap, headerOverrides },
        (type, data) => {
            send(type, data);
        }
    );

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('farm-complete', result);
    }
});

ipcMain.on('cancel-farm', () => {
    farmEngine.cancel();
});

// ── Unlock Config IPC ──

ipcMain.handle('get-unlock-config', () => {
    return proxy.getUnlockConfig();
});

ipcMain.handle('set-unlock-config', (event, config) => {
    proxy.setUnlockConfig(config);
    try {
        const fs = require('fs');
        if (!fs.existsSync(PRESTIGER_DIR)) {
            fs.mkdirSync(PRESTIGER_DIR, { recursive: true });
        }
        fs.writeFileSync(UNLOCK_CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (_) {}
    return { success: true };
});

ipcMain.handle('get-cosmetics-data', () => {
    return profileGenerator.getCosmeticsInfo();
});

// ── Tomes Config IPC ──

ipcMain.handle('get-tomes-config', () => {
    return { enabled: tomeCompleter.enabled };
});

ipcMain.handle('set-tomes-config', (event, config) => {
    tomeCompleter.setEnabled(config.enabled || false);
    try {
        const fs = require('fs');
        if (!fs.existsSync(PRESTIGER_DIR)) {
            fs.mkdirSync(PRESTIGER_DIR, { recursive: true });
        }
        fs.writeFileSync(TOMES_CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (_) {}
    return { success: true };
});

ipcMain.handle('get-tomes-status', () => {
    return tomeCompleter.getStatus();
});

// ── Debug IPC ──

ipcMain.handle('debug-export-logs', async (event, logs) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return { success: false, error: 'No window' };
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Debug Logs',
        defaultPath: `prestiger-debug-${stamp}.json`,
        filters: [
            { name: 'JSON', extensions: ['json'] },
            { name: 'All files', extensions: ['*'] }
        ]
    });
    if (result.canceled || !result.filePath) {
        return { success: false, cancelled: true };
    }
    try {
        const payload = {
            exportedAt: new Date().toISOString(),
            count: Array.isArray(logs) ? logs.length : 0,
            entries: Array.isArray(logs) ? logs : []
        };
        require('fs').writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
        return { success: true, path: result.filePath, count: payload.count };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('debug-replay-request', async (event, { method, url, headers, body } = {}) => {
    if (!url) return { ok: false, error: 'URL is required' };
    const start = Date.now();
    try {
        // axios will lowercase header keys when sending; that's fine for HTTP/1.1
        // because header names are case-insensitive per RFC 7230 §3.2.
        const response = await axios({
            method: (method || 'GET').toUpperCase(),
            url,
            headers: headers && typeof headers === 'object' ? headers : {},
            data: body && body.length > 0 ? body : undefined,
            timeout: 30000,
            validateStatus: () => true,
            // Return body as raw string so callers see the exact server bytes.
            transformResponse: [(r) => r],
            responseType: 'text',
            maxRedirects: 0
        });
        return {
            ok: true,
            status: response.status,
            statusText: response.statusText || '',
            headers: response.headers || {},
            body: typeof response.data === 'string' ? response.data : (response.data == null ? '' : String(response.data)),
            durationMs: Date.now() - start
        };
    } catch (err) {
        return {
            ok: false,
            error: err.message || 'Request failed',
            code: err.code || null,
            status: err.response?.status || 0,
            statusText: err.response?.statusText || '',
            headers: err.response?.headers || {},
            body: typeof err.response?.data === 'string' ? err.response.data : (err.response?.data == null ? '' : String(err.response.data)),
            durationMs: Date.now() - start
        };
    }
});

// ── Window Controls IPC ──
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());
