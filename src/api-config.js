function getApiConfig(platform, apiKey) {
    let url, headers;

    if (platform === 'ms_store') {
        url = 'https://grdk.live.bhvrdbd.com/api/v1/dbd-character-data/bloodweb';
        headers = {
            'Host': 'grdk.live.bhvrdbd.com',
            'Accept': '*/*',
            'Accept-Encoding': 'deflate, gzip',
            'Content-Type': 'application/json',
            'x-kraken-analytics-session-id': 'ee543239-4c67-c85c-d14a-5d8bea6665f6',
            'x-kraken-client-platform': 'grdk',
            'x-kraken-client-provider': 'grdk',
            'x-kraken-client-resolution': '1920x1080',
            'x-kraken-client-timezone-offset': '0',
            'x-kraken-client-os': '10.0.26200.1.768.64bit',
            'x-kraken-client-version': '9.4.0',
            'api-key': apiKey,
            'User-Agent': 'DeadByDaylight/DBD_Poutine_REL_WinGDK_Shipping_9_3050628 (http-legacy) WinGDK/10.0.26200.1.768.64bit'
        };
    } else if (platform === 'steam') {
        url = 'https://steam.live.bhvrdbd.com/api/v1/dbd-character-data/bloodweb';
        headers = {
            'Host': 'steam.live.bhvrdbd.com',
            'Accept': '*/*',
            'Accept-Encoding': 'deflate, gzip',
            'Content-Type': 'application/json',
            'x-kraken-analytics-session-id': '68f8bc3c-41bb-43e5-43b9-9484511a6c67',
            'x-kraken-client-platform': 'steam',
            'x-kraken-client-provider': 'steam',
            'x-kraken-client-resolution': '1920x1080',
            'x-kraken-client-timezone-offset': '0',
            'x-kraken-client-os': '10.0.26200.1.768.64bit',
            'x-kraken-client-version': '9.4.1',
            'api-key': apiKey,
            'User-Agent': 'DeadByDaylight/DBD_Poutine_HF1_Steam_Shipping_8_3068573 (http-legacy) Windows/10.0.26200.1.768.64bit'
        };
    } else {
        url = 'https://egs.live.bhvrdbd.com/api/v1/dbd-character-data/bloodweb';
        headers = {
            'Host': 'egs.live.bhvrdbd.com',
            'Accept': '*/*',
            'Accept-Encoding': 'deflate, gzip',
            'Content-Type': 'application/json',
            'x-kraken-analytics-session-id': '6565f031-4bbe-f9ab-2701-8f994f4c728a',
            'x-kraken-client-platform': 'egs',
            'x-kraken-client-provider': 'egs',
            'x-kraken-client-resolution': '1920x1080',
            'x-kraken-client-timezone-offset': '0',
            'x-kraken-client-os': '10.0.26200.1.768.64bit',
            'x-kraken-client-version': '9.3.0',
            'api-key': apiKey,
            'User-Agent': 'DeadByDaylight/DBD_Omelet_REL_EGS_Shipping_7_2868988 (http-legacy) EGS/10.0.26200.1.768.64bit'
        };
    }

    // Mark as internal request so our proxy doesn't intercept it
    headers['x-prestiger-internal'] = '1';

    return { url, headers };
}

module.exports = { getApiConfig };
