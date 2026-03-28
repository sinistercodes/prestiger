const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const MitmProxy = require('./src/tools/proxy');
const PrestigeEngine = require('./src/prestige-engine');
const FarmEngine = require('./src/farm-engine');
const ProfileGenerator = require('./src/profile-generator');
const { SURVIVORS, KILLERS, loadGameData } = require('./src/data');
const { findBhvrCookies } = require('./src/tools/cookieExtractor');
const { detectPlatform } = require('./src/tools/platformDetector');

const TomeCompleter = require('./src/tomes');

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
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('prestige-event', { type, ...data });
        }
    };

    const result = await engine.run(
        { ...config, contentNameMap },
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
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('farm-event', { type, ...data });
        }
    };

    const result = await farmEngine.run(
        { ...config, contentNameMap },
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

// ── Window Controls IPC ──
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());
