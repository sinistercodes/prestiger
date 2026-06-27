const fs = require('fs');
const path = require('path');
const os = require('os');

const PRESTIGER_DIR = path.join(os.homedir(), '.prestiger');
const LOADOUTS_DIR = path.join(PRESTIGER_DIR, 'loadouts');

/**
 * Per-character loadout persistence.
 *
 * Why this exists:
 *   BHVR's server stores loadouts but VALIDATES every slot against the
 *   player's actual server-side inventory on retrieval. Since we spoof the
 *   inventory client-side (qty 9999 for items the user doesn't really own),
 *   the server strips those invalid items from the loadout on every
 *   fetch — the player reopens the game and finds their carefully-crafted
 *   loadouts empty.
 *
 * Strategy:
 *   1. Capture: every POST/PUT to /api/v1/dbd-character-data/loadout
 *      contains the player's CURRENT intent (the full configured state).
 *      We persist it per character + gameMode to disk.
 *   2. Restore: every response from /loadout gets its `customizations` and
 *      `loadouts` blocks REPLACED with our disk version, so the game UI
 *      always sees the full state — server-stripped fields are masked.
 *   3. Anti-clobber: when the game POSTs a "fetch" payload (server's
 *      previously-stripped state) we'd normally overwrite our good disk
 *      copy with garbage. The score check below blocks captures whose
 *      content is meaningfully smaller than what's on disk.
 *
 * Files live at: ~/.prestiger/loadouts/<character>_<gameMode>.json
 */
class LoadoutStore {
    constructor() {
        try {
            if (!fs.existsSync(LOADOUTS_DIR)) {
                fs.mkdirSync(LOADOUTS_DIR, { recursive: true });
            }
        } catch (_) {}
    }

    _fileFor(character, gameMode) {
        const safeChar = String(character || '').replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeMode = String(gameMode || 'Online').replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(LOADOUTS_DIR, `${safeChar}_${safeMode}.json`);
    }

    /**
     * Scores a loadout payload by total meaningful content. Used by capture()
     * to detect "fetch with stripped data" attempts before they clobber a
     * good save on disk.
     *
     * Each non-`_EMPTY_` perk, addon, offering, custom name, charm and
     * non-default cosmetic preset entry contributes 1 point.
     */
    _scoreLoadouts(body) {
        if (!body) return 0;
        let score = 0;

        const loadouts = (body.loadouts && Array.isArray(body.loadouts.loadouts))
            ? body.loadouts.loadouts : [];
        for (const l of loadouts) {
            if (Array.isArray(l.perks)) {
                for (const p of l.perks) if (p && p !== '_EMPTY_') score += 1;
            }
            if (Array.isArray(l.addOns)) {
                for (const a of l.addOns) if (a && a !== '_EMPTY_') score += 1;
            }
            if (l.offering && l.offering !== '_EMPTY_') score += 1;
            if (l.name && String(l.name).trim()) score += 1;
        }

        const presets = (body.customizations && Array.isArray(body.customizations.presets))
            ? body.customizations.presets : [];
        for (const p of presets) {
            if (Array.isArray(p.charms)) score += p.charms.filter(c => c && c !== '_EMPTY_').length;
        }

        return score;
    }

    _hasAnyMeaningfulContent(body) {
        return this._scoreLoadouts(body) > 0;
    }

    /**
     * Persist a loadout submission for the character in `body.character`.
     * Returns the saved payload on success, null otherwise.
     *
     * Skip conditions:
     *   - No character name → can't key the file
     *   - Method is not POST/PUT (GET fetches don't carry save intent)
     *   - Body has zero non-empty fields anywhere (likely a default fetch)
     *   - Disk has strictly more content than the new payload (likely
     *     a server-stripped fetch trying to clobber a good save). The
     *     threshold gives 4 points of slack so legitimate small edits
     *     (one slot cleared) still go through.
     */
    capture(body, method) {
        if (!body || !body.character) return null;
        if (method) {
            const m = String(method).toUpperCase();
            if (m !== 'POST' && m !== 'PUT') return null;
        }
        if (!this._hasAnyMeaningfulContent(body)) return null;

        const newScore = this._scoreLoadouts(body);
        const existing = this.load(body.character, body.gameMode);
        if (existing) {
            const existingScore = this._scoreLoadouts(existing);
            if (existingScore > newScore + 4) {
                return null;
            }
        }

        try {
            const file = this._fileFor(body.character, body.gameMode);
            const payload = {
                savedAt: Date.now(),
                character: body.character,
                gameMode: body.gameMode || 'Online',
                customizations: body.customizations || null,
                loadouts: body.loadouts || null,
            };
            fs.writeFileSync(file, JSON.stringify(payload, null, 2));
            return payload;
        } catch (err) {
            console.error(`[LoadoutStore] capture error: ${err.message}`);
            return null;
        }
    }

    /**
     * Read previously-saved loadout for a character. Returns the parsed
     * payload, or null if no disk file or parse error.
     */
    load(character, gameMode) {
        if (!character) return null;
        try {
            const file = this._fileFor(character, gameMode);
            if (!fs.existsSync(file)) return null;
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (err) {
            console.error(`[LoadoutStore] load error: ${err.message}`);
            return null;
        }
    }

    /**
     * Returns a new response object with `customizations` and `loadouts`
     * replaced by disk state when available. Falls through to the original
     * response when no disk state exists for the character.
     *
     * Use as: const merged = store.restoreResponse(parsedJson);
     */
    restoreResponse(responseBody) {
        if (!responseBody || !responseBody.character) return responseBody;
        const stored = this.load(responseBody.character, responseBody.gameMode);
        if (!stored) return responseBody;

        return {
            ...responseBody,
            customizations: stored.customizations || responseBody.customizations,
            loadouts: stored.loadouts || responseBody.loadouts,
        };
    }

    /**
     * List every saved character + gameMode pair. Useful for UI / debugging.
     */
    list() {
        try {
            if (!fs.existsSync(LOADOUTS_DIR)) return [];
            const files = fs.readdirSync(LOADOUTS_DIR);
            return files
                .filter(f => f.endsWith('.json'))
                .map(f => {
                    try {
                        const data = JSON.parse(fs.readFileSync(path.join(LOADOUTS_DIR, f), 'utf8'));
                        return {
                            character: data.character,
                            gameMode: data.gameMode,
                            savedAt: data.savedAt,
                            file: f,
                        };
                    } catch (_) { return null; }
                })
                .filter(Boolean);
        } catch (_) { return []; }
    }
}

module.exports = { LoadoutStore, LOADOUTS_DIR };
