const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const os = require('os');

const COOKIE_NAME = 'bhvrSession';

const DOMAIN_PLATFORM_MAP = {
    'steam.live.bhvrdbd.com': 'steam',
    'egs.live.bhvrdbd.com': 'egs',
    'grdk.live.bhvrdbd.com': 'ms_store',
};

function getBrowserPaths() {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    const browsers = {
        chrome: path.join(localAppData, 'Google', 'Chrome', 'User Data'),
        edge: path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
    };

    const results = [];

    for (const [name, userData] of Object.entries(browsers)) {
        const localState = path.join(userData, 'Local State');
        if (!fs.existsSync(localState)) continue;

        // Check Default profile and numbered profiles
        const profiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3', 'Profile 4', 'Profile 5'];
        for (const profile of profiles) {
            const cookieDb = path.join(userData, profile, 'Network', 'Cookies');
            if (fs.existsSync(cookieDb)) {
                results.push({ browser: name, profile, localState, cookieDb });
            }
        }
    }

    return results;
}

function getEncryptionKey(localStatePath) {
    const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    const encryptedKey = Buffer.from(localState.os_crypt.encrypted_key, 'base64');
    // Strip 'DPAPI' prefix (5 bytes)
    const dpapiEncrypted = encryptedKey.slice(5);

    const b64Input = dpapiEncrypted.toString('base64');
    const psCommand = [
        'Add-Type -AssemblyName System.Security;',
        `$bytes = [Convert]::FromBase64String('${b64Input}');`,
        '$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
        '[Convert]::ToBase64String($dec)'
    ].join(' ');

    const result = execSync(`powershell -NoProfile -Command "${psCommand}"`, {
        encoding: 'utf8',
        windowsHide: true,
    }).trim();

    return Buffer.from(result, 'base64');
}

function decryptCookieValue(encryptedValue, key) {
    if (!encryptedValue || encryptedValue.length < 31) return null; // 3 prefix + 12 nonce + 16 tag minimum

    const prefix = encryptedValue.slice(0, 3).toString('utf8');
    if (prefix !== 'v10' && prefix !== 'v20') return null;

    const nonce = encryptedValue.slice(3, 15);
    const tag = encryptedValue.slice(encryptedValue.length - 16);
    const ciphertext = encryptedValue.slice(15, encryptedValue.length - 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
}

async function findBhvrCookies() {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();

    const browserPaths = getBrowserPaths();
    const found = [];
    const keyCache = {};

    for (const { browser, profile, localState, cookieDb } of browserPaths) {
        try {
            // Cache encryption key per Local State file
            if (!keyCache[localState]) {
                keyCache[localState] = getEncryptionKey(localState);
            }
            const key = keyCache[localState];

            // Copy cookie DB + WAL to temp (DB is locked while browser runs)
            const tmpBase = path.join(os.tmpdir(), `bhvr_cookies_${Date.now()}_${Math.random().toString(36).slice(2)}`);
            fs.copyFileSync(cookieDb, tmpBase);

            const walFile = cookieDb + '-wal';
            if (fs.existsSync(walFile)) {
                fs.copyFileSync(walFile, tmpBase + '-wal');
            }
            const shmFile = cookieDb + '-shm';
            if (fs.existsSync(shmFile)) {
                fs.copyFileSync(shmFile, tmpBase + '-shm');
            }

            try {
                const dbBuffer = fs.readFileSync(tmpBase);
                const db = new SQL.Database(dbBuffer);

                const stmt = db.prepare(
                    "SELECT host_key, encrypted_value, expires_utc FROM cookies WHERE name = ? AND host_key LIKE '%bhvrdbd.com' ORDER BY expires_utc DESC"
                );
                stmt.bind([COOKIE_NAME]);

                while (stmt.step()) {
                    const row = stmt.getAsObject();
                    try {
                        const decrypted = decryptCookieValue(Buffer.from(row.encrypted_value), key);
                        if (decrypted) {
                            const host = row.host_key.replace(/^\./, '');
                            found.push({
                                browser,
                                profile,
                                domain: host,
                                platform: DOMAIN_PLATFORM_MAP[host] || null,
                                value: decrypted,
                                expires: Number(row.expires_utc),
                            });
                        }
                    } catch (decryptErr) {
                        // Skip cookies that fail to decrypt
                    }
                }

                stmt.free();
                db.close();
            } finally {
                // Clean up temp files
                try { fs.unlinkSync(tmpBase); } catch (_) {}
                try { fs.unlinkSync(tmpBase + '-wal'); } catch (_) {}
                try { fs.unlinkSync(tmpBase + '-shm'); } catch (_) {}
            }
        } catch (err) {
            console.error(`Error reading ${browser}/${profile} cookies:`, err.message);
        }
    }

    // Deduplicate by value, prefer most recent expiry
    const seen = new Map();
    for (const cookie of found) {
        const existing = seen.get(cookie.value);
        if (!existing || cookie.expires > existing.expires) {
            seen.set(cookie.value, cookie);
        }
    }

    return Array.from(seen.values());
}

module.exports = { findBhvrCookies };
