/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    api: WindowApi;
    windowControls: WindowControls;
  }

  interface WindowApi {
    getCharacters: () => Promise<{ survivors: Character[]; killers: Character[] }>;
    getItems: () => Promise<GameItem[]>;
    getAddons: () => Promise<GameItem[]>;
    getOfferings: () => Promise<GameItem[]>;
    getCookie: () => Promise<{ cookies: CapturedCookie[]; source: string }>;
    detectPlatform: () => Promise<{ detected: boolean; platform: string | null; exe: string | null }>;
    getProxyStatus: () => Promise<ProxyStatus>;
    proxyStart: () => Promise<{ success: boolean; message: string }>;
    proxyStop: () => Promise<{ success: boolean; message: string }>;
    proxyInstallCert: () => Promise<{ success: boolean; error?: string }>;
    proxyRemoveCert: () => Promise<{ success: boolean; error?: string }>;
    clearCapturedSessions: () => Promise<{ success: boolean }>;
    startPrestige: (config: PrestigeConfig) => void;
    cancelPrestige: () => void;
    onPrestigeEvent: (callback: (data: PrestigeEvent) => void) => () => void;
    onPrestigeComplete: (callback: (data: PrestigeResult) => void) => () => void;
    onCookieCaptured: (callback: (data: { platform: string; cookie: string }) => void) => () => void;
    // Farming
    startFarm: (config: FarmConfig) => void;
    cancelFarm: () => void;
    onFarmEvent: (callback: (data: FarmEvent) => void) => () => void;
    onFarmComplete: (callback: (data: FarmResult) => void) => () => void;
    // Unlock
    setUnlockConfig: (config: any) => Promise<{ success: boolean }>;
    getUnlockConfig: () => Promise<any>;
    getCosmeticsData: () => Promise<CosmeticsInfo>;
    // Debug
    onRequestLog: (callback: (data: ProxyRequestLog) => void) => () => void;
    // Tomes
    getTomesConfig: () => Promise<{ enabled: boolean }>;
    setTomesConfig: (config: { enabled: boolean }) => Promise<{ success: boolean }>;
    getTomesStatus: () => Promise<TomesStatus>;
    onTomeEvent: (callback: (data: TomeEvent) => void) => () => void;
  }

  interface TomesStatus {
    enabled: boolean;
    hasHeaders: boolean;
    completedCount: number;
    lastMatch: string | null;
  }

  interface TomeEvent {
    type: string;
    nodeId?: string;
    storyId?: string;
    progress?: string;
    total?: number;
    message?: string;
  }

  interface ProxyRequestLog {
    timestamp: number;
    method: string;
    host: string;
    path: string;
    status: number;
    size: number;
    intercepted: string | null;
    snooped: string | null;
    requestBody: string | null;
    responseBody: string | null;
  }

  interface WindowControls {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  }

  interface Character {
    name: string;
    id: string;
  }

  interface GameItem {
    ItemId: string;
    Name: string;
    CharacterType?: string;
    Rarity?: string;
    Availability?: string;
  }

  interface CapturedCookie {
    platform: string;
    value: string;
    capturedAt?: number;
    browser?: string;
    profile?: string;
    domain?: string;
    expires?: number;
  }

  interface ProxyStatus {
    running: boolean;
    certInstalled: boolean;
    capturedCookies: CapturedCookie[];
  }

  interface PrestigeConfig {
    bhvrSession: string;
    characterId: string;
    prestigeCount: number;
    platform: string;
    sniperConfig: string[];
  }

  interface PrestigeEvent {
    type: 'log' | 'bloodpoints' | 'progress' | 'summary';
    message?: string;
    value?: number;
    prestigesDone?: number;
    totalTarget?: number;
    bloodWebLevel?: number;
    prestigeLevel?: number;
    snipedItems?: Record<string, number>;
  }

  interface PrestigeResult {
    prestigesDone: number;
    totalTarget: number;
    snipedItems: Record<string, number>;
    error?: string;
  }

  interface FarmConfig {
    bhvrSession: string;
    characterId: string;
    sniperConfig: string[];
    mode: string;
    platform: string;
  }

  interface FarmEvent {
    type: 'log' | 'snipedItem' | 'stats';
    message?: string;
    name?: string;
    total?: number;
    bloodpointsSpent?: number;
    startingBalance?: number;
    currentBalance?: number;
  }

  interface FarmResult {
    snipedItems: Record<string, number>;
    bloodwebsProcessed: number;
    error?: string;
  }

  interface CosmeticsInfo {
    count: number;
    lastUpdated: string | null;
    hasLiveData: boolean;
  }
}
