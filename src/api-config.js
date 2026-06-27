const crypto = require('crypto');

// Per-platform host, client version, and User-Agent values used to mint
// requests that look like the real DBD game client.
//
// Values calibrated 2026-06-27 against a live Steam capture: Sushi HF1
// build 5_3454504, client version 10.0.1, Windows build 26100, http-eventloop
// transport. The other platform entries follow the same naming convention but
// may drift sooner; the runtime override path (headerOverrides from a proxy
// capture) is the long-term answer here.
const PLATFORM_CONFIG = {
    ms_store: {
        host: 'grdk.live.bhvrdbd.com',
        krakenPlatform: 'grdk',
        clientVersion: '10.0.1',
        clientOs: '10.0.26100.1.256.64bit',
        userAgent: 'DeadByDaylight/DBD_Sushi_HF1_WinGDK_Shipping_5_3454504 (http-eventloop) WinGDK/10.0.26100.1.256.64bit'
    },
    steam: {
        host: 'steam.live.bhvrdbd.com',
        krakenPlatform: 'steam',
        clientVersion: '10.0.1',
        clientOs: '10.0.26100.1.256.64bit',
        userAgent: 'DeadByDaylight/DBD_Sushi_HF1_Steam_Shipping_5_3454504 (http-eventloop) Windows/10.0.26100.1.256.64bit'
    },
    egs: {
        host: 'egs.live.bhvrdbd.com',
        krakenPlatform: 'egs',
        clientVersion: '10.0.1',
        clientOs: '10.0.26100.1.256.64bit',
        userAgent: 'DeadByDaylight/DBD_Sushi_HF1_EGS_Shipping_5_3454504 (http-eventloop) EGS/10.0.26100.1.256.64bit'
    }
};

// Header keys (lower-cased) that headerOverrides is ALLOWED to replace.
// We deliberately do NOT let overrides clobber the api-key, internal marker,
// host, or content-type — those are protocol-critical and engine-owned.
const OVERRIDABLE = new Set([
    'user-agent',
    'x-kraken-client-platform',
    'x-kraken-client-provider',
    'x-kraken-analytics-platform',
    'x-kraken-client-resolution',
    'x-kraken-client-timezone-offset',
    'x-kraken-client-os',
    'x-kraken-client-version',
    'x-kraken-analytics-session-id',
    'x-kraken-analytics-dynamic-contents'
]);

/**
 * Build the request shape for a given platform/session-key combination.
 *
 * @param platform         steam | egs | ms_store (unknown -> egs)
 * @param apiKey           value for the `api-key` header
 * @param headerOverrides  optional case-insensitive Record<string,string> of
 *                         headers that should replace defaults. Used to feed
 *                         the engines with the EXACT headers the game client
 *                         was last seen sending (captured by the proxy), so
 *                         our traffic is byte-for-byte indistinguishable.
 *                         Only OVERRIDABLE keys take effect.
 *
 * Returns:
 *   baseUrl  : protocol + host
 *   headers  : full BHVR-compatible header set (incl. x-prestiger-internal=1
 *              to mark the request as ours so our own MITM proxy ignores it)
 *   urls     : { probe, buy, bulkSpend }
 *     probe     : POST /api/v1/dbd-character-data/bloodweb/v2
 *                 used for the initial probe and for any PLAYER-actor purchase
 *     buy       : same as probe, exposed as a separate name for readability
 *                 when used for path-based sniping
 *     bulkSpend : POST /api/v1/dbd-character-data/bulk-spending-bloodweb
 *                 used for the level-skip exploit and the prestige-up call
 */
function getApiConfig(platform, apiKey, headerOverrides) {
    const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.egs;
    const baseUrl = `https://${cfg.host}`;

    const headers = {
        Host: cfg.host,
        Accept: '*/*',
        'Accept-Encoding': 'deflate, gzip',
        'Content-Type': 'application/json',
        Connection: 'Keep-Alive',
        // Fresh per-call UUID matches what the live client does (auth-issued
        // tokens are tied to one game session and rotate; analytics-session-id
        // is a fresh GUID for each request in the captured traffic).
        'x-kraken-analytics-session-id': crypto.randomUUID(),
        'x-kraken-client-platform': cfg.krakenPlatform,
        'x-kraken-client-provider': cfg.krakenPlatform,
        // The live client also sets analytics-platform alongside client-platform.
        'x-kraken-analytics-platform': cfg.krakenPlatform,
        'x-kraken-client-resolution': '2560x1440',
        'x-kraken-client-timezone-offset': '-60',
        'x-kraken-client-os': cfg.clientOs,
        'x-kraken-client-version': cfg.clientVersion,
        // The live client sends an array of equipped cosmetic content-ids; an
        // empty array matches a player with default appearance and avoids 400s
        // from servers that expect the header to exist.
        'x-kraken-analytics-dynamic-contents': '[]',
        'api-key': apiKey,
        'User-Agent': cfg.userAgent,
        // Marker so our MITM proxy doesn't intercept our own outgoing traffic.
        'x-prestiger-internal': '1'
    };

    // Apply runtime overrides (e.g. proxy-captured live headers).
    if (headerOverrides && typeof headerOverrides === 'object') {
        for (const rawKey of Object.keys(headerOverrides)) {
            const lk = rawKey.toLowerCase();
            if (!OVERRIDABLE.has(lk)) continue;
            const value = headerOverrides[rawKey];
            if (value == null) continue;
            // Preserve the default header's canonical casing when present
            // (e.g. proxy-captured 'user-agent' maps onto our default 'User-Agent'
            // entry rather than creating a second lowercase key).
            let canonicalKey = null;
            for (const existing of Object.keys(headers)) {
                if (existing.toLowerCase() === lk) {
                    canonicalKey = existing;
                    break;
                }
            }
            headers[canonicalKey || rawKey] = String(value);
        }
    }

    return {
        baseUrl,
        headers,
        urls: {
            probe:     `${baseUrl}/api/v1/dbd-character-data/bloodweb/v2`,
            buy:       `${baseUrl}/api/v1/dbd-character-data/bloodweb/v2`,
            bulkSpend: `${baseUrl}/api/v1/dbd-character-data/bulk-spending-bloodweb`
        }
    };
}

module.exports = { getApiConfig, PLATFORM_CONFIG };
