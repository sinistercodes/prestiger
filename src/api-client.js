const axios = require('axios');

/**
 * Adaptive HTTP client for the BHVR bloodweb API.
 *
 * Mirrors the reference DBD prestige injector's pacing model:
 *   - base delay 1ms before every request
 *   - adaptive delay grows by 10ms on each 429 (cap 3000ms)
 *   - +/- 10% jitter on the combined delay
 *   - adaptive delay resets to 0 after every successful request
 *
 * Error handling:
 *   - 429 -> grow adaptive, wait 1500-2500ms, retry indefinitely
 *   - 403 -> wait 50,000ms (IP rate limit), retry indefinitely
 *   - 400 + body contains "BlW_deductCur_invalid" -> clean OUT_OF_BLOODPOINTS stop
 *   - 5xx / 408 / network -> linear backoff capped at 8s, configurable retry budget
 *   - other 4xx -> FATAL stop
 *
 * Cancellation is checked before every POST and before resuming from a long wait.
 */
class ApiClient {
    constructor({ baseUrl, headers, onEvent, baseDelayMs = 1, maxAdaptiveMs = 3000 }) {
        this.baseUrl = baseUrl;
        this.headers = headers;
        this.onEvent = onEvent;
        this.baseDelayMs = baseDelayMs;
        this.maxAdaptiveMs = maxAdaptiveMs;
        this.adaptiveDelay = 0;
    }

    _log(message) {
        if (this.onEvent) this.onEvent('log', { message });
    }

    _getCurrentDelay() {
        const total = this.baseDelayMs + this.adaptiveDelay;
        const variation = Math.floor(total * 0.1);
        const jitter = variation > 0
            ? Math.floor(Math.random() * (variation * 2 + 1)) - variation
            : 0;
        return Math.max(0, total + jitter);
    }

    _resetAdaptive() {
        this.adaptiveDelay = 0;
    }

    _growAdaptive() {
        this.adaptiveDelay = Math.min(this.adaptiveDelay + 10, this.maxAdaptiveMs);
    }

    /**
     * Cancellable sleep. Returns true if it slept through, false if cancelled mid-sleep.
     * Chunks long waits into 250ms slices so cancellation feels responsive on 50s 403 cooldowns.
     */
    async _sleep(ms, isCancelled) {
        if (ms <= 0) return true;
        const chunk = 250;
        let remaining = ms;
        while (remaining > 0) {
            if (isCancelled && isCancelled()) return false;
            const wait = Math.min(chunk, remaining);
            await new Promise(resolve => setTimeout(resolve, wait));
            remaining -= wait;
        }
        return true;
    }

    _extractBodyString(err) {
        const body = err.response?.data;
        if (typeof body === 'string') return body;
        if (body && typeof body === 'object') {
            try { return JSON.stringify(body); } catch (_) { return ''; }
        }
        return '';
    }

    _stringify(value) {
        if (value == null) return null;
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch (_) { return String(value); }
    }

    _normalizeHeaders(headers) {
        if (!headers || typeof headers !== 'object') return null;
        const out = {};
        for (const key of Object.keys(headers)) {
            const v = headers[key];
            if (v == null) continue;
            out[key] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        return out;
    }

    _emitWire(url, requestBody, status, responseBody, responseHeaders) {
        if (!this.onEvent) return;
        let host = '', path = url;
        try {
            const u = new URL(url);
            host = u.host;
            path = u.pathname + (u.search || '');
        } catch (_) {}
        const reqBodyStr = this._stringify(requestBody);
        const resBodyStr = this._stringify(responseBody);
        this.onEvent('wire', {
            timestamp: Date.now(),
            source: 'engine',
            method: 'POST',
            host,
            path,
            status: status || 0,
            size: resBodyStr ? Buffer.byteLength(resBodyStr, 'utf8') : 0,
            intercepted: null,
            snooped: null,
            requestBody: reqBodyStr,
            responseBody: resBodyStr,
            requestHeaders: this._normalizeHeaders(this.headers),
            responseHeaders: this._normalizeHeaders(responseHeaders),
        });
    }

    /**
     * POST `url` with `body` and the configured headers.
     *
     * Options:
     *   isCancelled() -> bool : called periodically; return true to abort.
     *   maxRetries           : transient-error retry budget (default Infinity).
     *   label                : human-readable name used in log messages.
     *
     * Returns:
     *   { ok: true,  data }                                    on success
     *   { ok: false, reason: 'CANCELLED' }                     if cancelled
     *   { ok: false, reason: 'OUT_OF_BLOODPOINTS' }            on BlW_deductCur_invalid
     *   { ok: false, reason: 'MAX_RETRIES', error, status }    after exhausting retries
     *   { ok: false, reason: 'FATAL',       error, status }    on any other hard error
     */
    async post(url, body, { isCancelled, maxRetries = Infinity, label = 'request' } = {}) {
        let transientAttempts = 0;

        while (true) {
            if (isCancelled && isCancelled()) return { ok: false, reason: 'CANCELLED' };

            const preDelay = this._getCurrentDelay();
            if (!(await this._sleep(preDelay, isCancelled))) {
                return { ok: false, reason: 'CANCELLED' };
            }

            try {
                const response = await axios.post(url, body, {
                    headers: this.headers,
                    timeout: 15000
                });
                this._resetAdaptive();
                this._emitWire(url, body, response.status, response.data, response.headers);
                return { ok: true, data: response.data };
            } catch (err) {
                const status = err.response?.status;
                const bodyStr = this._extractBodyString(err);
                this._emitWire(url, body, status || 0, err.response?.data ?? bodyStr, err.response?.headers);

                // Out of bloodpoints — clean stop, no retry.
                if (status === 400 && bodyStr.includes('BlW_deductCur_invalid')) {
                    this._log('Out of Bloodpoints. Stopping.');
                    return { ok: false, reason: 'OUT_OF_BLOODPOINTS', error: err, status };
                }

                // Per-character 429 — adaptive backoff.
                if (status === 429) {
                    this._growAdaptive();
                    const wait = 1500 + Math.floor(Math.random() * 1001);
                    this._log(`429 rate limit on ${label}. Backing off ${wait}ms (adaptive +10ms = ${this.adaptiveDelay}ms).`);
                    if (!(await this._sleep(wait, isCancelled))) {
                        return { ok: false, reason: 'CANCELLED' };
                    }
                    continue;
                }

                // IP-level 403 — long cooldown.
                if (status === 403) {
                    this._log(`403 IP rate limit on ${label}. Cooling down 50s...`);
                    if (!(await this._sleep(50000, isCancelled))) {
                        return { ok: false, reason: 'CANCELLED' };
                    }
                    continue;
                }

                // Transient — retry with linear backoff up to maxRetries.
                if (!status || status === 408 || status >= 500) {
                    transientAttempts++;
                    if (transientAttempts > maxRetries) {
                        this._log(`${label}: max retries (${maxRetries}) exceeded.`);
                        return { ok: false, reason: 'MAX_RETRIES', error: err, status };
                    }
                    const wait = Math.min(1000 * transientAttempts, 8000);
                    const budget = maxRetries === Infinity ? '∞' : maxRetries;
                    this._log(`${label} failed (${status || 'network'}), retry ${transientAttempts}/${budget} in ${Math.round(wait / 1000)}s.`);
                    if (!(await this._sleep(wait, isCancelled))) {
                        return { ok: false, reason: 'CANCELLED' };
                    }
                    continue;
                }

                // Anything else — fatal.
                this._log(`${label} fatal error (${status}): ${bodyStr.substring(0, 200)}`);
                return { ok: false, reason: 'FATAL', error: err, status };
            }
        }
    }
}

/**
 * Map a failed ApiClient result to a user-facing message string.
 */
function formatApiError(result) {
    if (!result) return 'Unknown error';
    switch (result.reason) {
        case 'OUT_OF_BLOODPOINTS': return 'Out of Bloodpoints.';
        case 'MAX_RETRIES':       return `Network/server error after retries (${result.status || 'no status'}).`;
        case 'FATAL':             return `Server error (${result.status || 'unknown'}).`;
        case 'CANCELLED':         return 'Cancelled.';
        default:                  return result.error?.message || 'Unknown error';
    }
}

module.exports = { ApiClient, formatApiError };
