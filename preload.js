const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowControls', {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close')
});

contextBridge.exposeInMainWorld('api', {
    getCharacters: () => ipcRenderer.invoke('get-characters'),
    getItems: () => ipcRenderer.invoke('get-items'),
    getAddons: () => ipcRenderer.invoke('get-addons'),
    getOfferings: () => ipcRenderer.invoke('get-offerings'),
    getCookie: () => ipcRenderer.invoke('get-cookie'),
    detectPlatform: () => ipcRenderer.invoke('detect-platform'),
    getProxyStatus: () => ipcRenderer.invoke('proxy-get-status'),
    proxyStart: () => ipcRenderer.invoke('proxy-start'),
    proxyStop: () => ipcRenderer.invoke('proxy-stop'),
    proxyInstallCert: () => ipcRenderer.invoke('proxy-install-cert'),
    proxyRemoveCert: () => ipcRenderer.invoke('proxy-remove-cert'),
    clearCapturedSessions: () => ipcRenderer.invoke('proxy-clear-sessions'),
    startPrestige: (config) => ipcRenderer.send('start-prestige', config),
    cancelPrestige: () => ipcRenderer.send('cancel-prestige'),
    onPrestigeEvent: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('prestige-event', listener);
        return () => ipcRenderer.removeListener('prestige-event', listener);
    },
    onPrestigeComplete: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('prestige-complete', listener);
        return () => ipcRenderer.removeListener('prestige-complete', listener);
    },
    onCookieCaptured: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('proxy-cookie-captured', listener);
        return () => ipcRenderer.removeListener('proxy-cookie-captured', listener);
    },
    // Farming
    startFarm: (config) => ipcRenderer.send('start-farm', config),
    cancelFarm: () => ipcRenderer.send('cancel-farm'),
    onFarmEvent: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('farm-event', listener);
        return () => ipcRenderer.removeListener('farm-event', listener);
    },
    onFarmComplete: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('farm-complete', listener);
        return () => ipcRenderer.removeListener('farm-complete', listener);
    },
    // Unlock
    setUnlockConfig: (config) => ipcRenderer.invoke('set-unlock-config', config),
    getUnlockConfig: () => ipcRenderer.invoke('get-unlock-config'),
    getCosmeticsData: () => ipcRenderer.invoke('get-cosmetics-data'),
    // Debug
    onRequestLog: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('proxy-request-log', listener);
        return () => ipcRenderer.removeListener('proxy-request-log', listener);
    },
    // Tomes
    getTomesConfig: () => ipcRenderer.invoke('get-tomes-config'),
    setTomesConfig: (config) => ipcRenderer.invoke('set-tomes-config', config),
    getTomesStatus: () => ipcRenderer.invoke('get-tomes-status'),
    onTomeEvent: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('tome-event', listener);
        return () => ipcRenderer.removeListener('tome-event', listener);
    },
});
