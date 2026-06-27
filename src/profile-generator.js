const fs = require('fs');
const path = require('path');

const PRESTIGER_DIR = path.join(require('os').homedir(), '.prestiger');
const COSMETICS_CACHE_PATH = path.join(PRESTIGER_DIR, 'cosmetics-cache.json');

class ProfileGenerator {
    constructor(appPath) {
        this.appPath = appPath;
        this.userId = null;

        // Load the actual MarketFiles as base templates — these contain the exact
        // JSON structure the game expects, with all characters, items, perks, etc.
        // We modify prestige/quantities/userId at serve time rather than building from scratch.
        const marketDir = path.join(appPath, 'data', 'market');

        this.baseProfile = this._loadJson(path.join(marketDir, 'GetAll.json'));
        this.baseBloodweb = this._loadJson(path.join(marketDir, 'Bloodweb.json'));
        this.baseInventory = this._loadJson(path.join(marketDir, 'Market.json'));
        this.baseCurrency = this._loadJson(path.join(marketDir, 'Currency.json'));
        this.baseLevel = this._loadJson(path.join(marketDir, 'Level.json'));
        this.baseKillswitch = this._loadJson(path.join(marketDir, 'Killswitch.json'));

        // Load game data files for injecting missing items into profiles
        this.itemsData = this._loadJson(path.join(appPath, 'data', 'Items.json')) || [];
        this.addonsData = this._loadJson(path.join(appPath, 'data', 'Addons.json')) || [];
        this.offeringsData = this._loadJson(path.join(appPath, 'data', 'Offerings.json')) || [];

        // Build explicit ID sets for proper categorization (no heuristics)
        const perksArray = this._loadJson(path.join(appPath, 'data', 'Perks.json')) || [];
        this.perkIds = new Set(perksArray);
        this.itemIds = new Set(this.itemsData.map(i => i.ItemId));
        this.addonIds = new Set(this.addonsData.map(a => a.ItemId));
        this.offeringIds = new Set(this.offeringsData.map(o => o.ItemId));

        // Load cosmetics baseline (extracted from Market.json)
        this.cosmeticsBaseline = [];
        try {
            this.cosmeticsBaseline = require(path.join(appPath, 'data', 'Cosmetics.json'));
        } catch (_) {}

        // Load cached live cosmetics
        this.cachedLiveCosmetics = [];
        this.loadCosmeticsCache();
    }

    _loadJson(filePath) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (err) {
            console.error(`[ProfileGenerator] Failed to load ${filePath}: ${err.message}`);
            return null;
        }
    }

    _deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    setUserId(userId) {
        this.userId = userId;
    }

    // ── Cosmetics Cache ──

    loadCosmeticsCache() {
        try {
            if (fs.existsSync(COSMETICS_CACHE_PATH)) {
                this.cachedLiveCosmetics = JSON.parse(fs.readFileSync(COSMETICS_CACHE_PATH, 'utf8'));
            }
        } catch (_) {
            this.cachedLiveCosmetics = [];
        }
    }

    saveCosmeticsCache() {
        try {
            if (!fs.existsSync(PRESTIGER_DIR)) {
                fs.mkdirSync(PRESTIGER_DIR, { recursive: true });
            }
            fs.writeFileSync(COSMETICS_CACHE_PATH, JSON.stringify(this.cachedLiveCosmetics));
        } catch (_) {}
    }

    mergeLiveCosmetics(liveInventoryItems) {
        const existingIds = new Set(this.cachedLiveCosmetics.map(c => c.objectId));
        let added = 0;
        for (const item of liveInventoryItems) {
            const id = item.objectId;
            // Only cache actual cosmetics — skip perks, items, addons, offerings
            if (this.perkIds.has(id) || this.itemIds.has(id) || this.addonIds.has(id) || this.offeringIds.has(id)) continue;
            if (!existingIds.has(id)) {
                this.cachedLiveCosmetics.push({
                    objectId: id,
                    lastUpdatedAt: item.lastUpdatedAt || Math.floor(Date.now() / 1000)
                });
                existingIds.add(id);
                added++;
            }
        }
        if (added > 0) {
            this.saveCosmeticsCache();
        }
        return added;
    }

    getMergedCosmetics() {
        const seen = new Set();
        const merged = [];
        for (const item of [...this.cosmeticsBaseline, ...this.cachedLiveCosmetics]) {
            if (!seen.has(item.objectId)) {
                seen.add(item.objectId);
                merged.push(item);
            }
        }
        return merged;
    }

    getCosmeticsInfo() {
        const merged = this.getMergedCosmetics();
        return {
            count: merged.length,
            lastUpdated: this.cachedLiveCosmetics.length > 0
                ? new Date(Math.max(...this.cachedLiveCosmetics.map(c => (c.lastUpdatedAt || 0) * 1000))).toISOString()
                : null,
            hasLiveData: this.cachedLiveCosmetics.length > 0
        };
    }

    // ── Helpers ──

    _resolveValue(value, min, max) {
        if (value === 'random') {
            const lo = min || 0;
            const hi = max || 100;
            return Math.floor(Math.random() * (hi - lo + 1)) + lo;
        }
        return value;
    }

    _isPerk(itemId) {
        return itemId ? this.perkIds.has(itemId) : false;
    }

    _isConsumable(itemId) {
        if (this.itemIds.has(itemId) || this.addonIds.has(itemId) || this.offeringIds.has(itemId)) return true;
        // Fallback: catch items/addons not yet in our data files by prefix
        const lower = itemId.toLowerCase();
        return lower.startsWith('item_') || lower.startsWith('addon_') || lower.includes('themeoffering') || lower.includes('offering');
    }

    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /**
     * Returns the configured item quantity, clamped to 1-999.
     *
     * Why 999: every reference project (Cursed-Market, Eclipsed.Light,
     * Igromanru, Melancholy's CustomItemAmount / CustomAddonAmount /
     * CustomOfferingAmount tables) uses 999 for all consumables. DBD's
     * client-side validation rejects quantities >999 for offerings (and
     * possibly items/addons in future patches), causing the equipped slot
     * to show 0. The slider in the renderer is also capped at 999, but
     * stale configs saved before the cap change can still carry 9999 —
     * this runtime clamp catches those.
     */
    _clampedItemQuantity(config) {
        return Math.min(Math.max(config.itemQuantity || 999, 1), 999);
    }

    // ── Profile Generators ──
    // These clone the actual MarketFiles templates and modify prestige/quantities/userId.
    // This matches how Fortnite Burger works — serve the real files, just tweak values.

    /**
     * Builds the UNIVERSAL characterItems array used for every character in
     * /get-all and bloodweb responses.
     *
     * Reference: Cursed-Market's cached CharacterData template — every
     * character (survivors AND killers) gets the SAME 1,416-item array with
     * no role-based filtering. The game UI does its own per-character
     * filtering at render time (survivors won't show killer addons in their
     * picker), so the data layer just dumps everything and lets the client
     * sort it out.
     *
     * Why this matters: the previous role-filtered approach silently dropped
     * items whose CharacterType field was missing or mismatched (new
     * anniversary items, new characters like S53/K42/K43 whose items weren't
     * yet wired up). Those dropped items then showed quantity 0 in equipped
     * loadout slots while remaining visible in the inventory grid — the
     * exact "equip shows 0" bug the user reported.
     *
     * Quantities:
     *   - perks at 3 (max tier — unlocks LEVEL 5/10/15 slots)
     *   - everything else at the configured itemQuantity
     */
    _buildUniversalCharacterItems(itemQuantity, config) {
        const items = [];
        const seen = new Set();

        const push = (id, quantity) => {
            if (!id || seen.has(id)) return;
            seen.add(id);
            items.push({ itemId: id, quantity });
        };

        // Per-category gating. Each toggle defaults to true for backward
        // compatibility with old configs that don't have these fields.
        const perksEnabled = !config || config.perks?.enabled !== false;
        const itemsEnabled = !config || config.items?.enabled !== false;

        if (perksEnabled) for (const perkId of this.perkIds) push(perkId, 3);
        // Items, addons, and offerings share ONE toggle — they're all
        // consumables bought from the same inventory.
        if (itemsEnabled) {
            for (const item of this.itemsData) push(item.ItemId, itemQuantity);
            for (const addon of this.addonsData) push(addon.ItemId, itemQuantity);
            for (const offering of this.offeringsData) push(offering.ItemId, itemQuantity);
        }

        return items;
    }

    generateGetAll(config) {
        if (!this.baseProfile) return { list: [] };

        const profile = this._deepClone(this.baseProfile);
        const itemQuantity = this._clampedItemQuantity(config);

        // Build ONE universal characterItems array, used for every character.
        // Cursed-Market FiddlerCore.cs (lines 460-524) does exactly this:
        // every character in their cached CharacterData template shares the
        // same item array. We REPLACE (not merge) the template's
        // characterItems so stale per-character data can't shadow our
        // universal injection.
        const universalItems = this._buildUniversalCharacterItems(itemQuantity, config);

        for (const character of profile.list) {
            const prestige = this._resolveValue(
                config.characters.prestigeLevel,
                config.characters.prestigeRandomMin,
                config.characters.prestigeRandomMax
            );
            character.prestigeLevel = prestige;
            if ('legacyPrestigeLevel' in character) {
                character.legacyPrestigeLevel = prestige;
            }

            // Shallow-clone the array per character so downstream code can
            // mutate one char's items without affecting all of them. The
            // inner item objects are still shared by reference — fine for
            // JSON serialization, which doesn't mutate.
            character.characterItems = universalItems.slice();
        }

        return profile;
    }

    generateBloodweb(config) {
        if (!this.baseBloodweb) {
            return {
                bloodwebLevelChanged: false,
                updatedWallets: [],
                characterName: "",
                bloodWebLevel: 50,
                prestigeLevel: 100,
                bloodWebData: { paths: [], ringData: [] },
                characterItems: []
            };
        }

        const bloodweb = this._deepClone(this.baseBloodweb);
        const itemQuantity = this._clampedItemQuantity(config);

        // Set prestige and bloodweb level
        bloodweb.prestigeLevel = this._resolveValue(
            config.characters.prestigeLevel,
            config.characters.prestigeRandomMin,
            config.characters.prestigeRandomMax
        );
        bloodweb.bloodWebLevel = this._resolveValue(
            config.characters.bloodwebLevel,
            config.characters.bloodwebRandomMin,
            config.characters.bloodwebRandomMax
        );
        if (typeof bloodweb.bloodWebLevel === 'number') {
            bloodweb.bloodWebLevel = Math.min(Math.max(bloodweb.bloodWebLevel, 1), 50);
        } else {
            bloodweb.bloodWebLevel = 50;
        }

        // REPLACE the template's characterItems with our universal array so
        // every item the user might equip from this bloodweb is present at
        // the right quantity. The template's static list is missing newer
        // items (anniversary 2026, new char addons, etc) and using only
        // it caused equipped slots to show 0 for those items.
        bloodweb.characterItems = this._buildUniversalCharacterItems(itemQuantity, config);

        return bloodweb;
    }

    /**
     * Generates a complete bloodweb response for a specific character.
     * Like Cursed Market: intercepts the request entirely (doesn't snoop),
     * uses our template + character data, forces 200 response.
     * This ensures even unowned characters get proper data.
     */
    generateBloodwebForCharacter(reqBodyStr, config) {
        const bloodweb = this.generateBloodweb(config);

        // Get character name from the request body
        let characterName = '';
        if (reqBodyStr) {
            try {
                const reqData = JSON.parse(reqBodyStr);
                if (reqData.characterName) {
                    characterName = reqData.characterName;
                }
            } catch (_) {}
        }
        bloodweb.characterName = characterName;

        // Inject characterItems from our generated get-all data for this character
        const fullProfile = this.generateGetAll(config);
        const charData = fullProfile.list.find(c => c.characterName === characterName);
        if (charData && charData.characterItems) {
            bloodweb.characterItems = charData.characterItems;
        }

        return bloodweb;
    }

    generateInventories(config) {
        const cosmetics = this.getMergedCosmetics();
        const timestamp = Math.floor(Date.now() / 1000);
        const itemQuantity = this._clampedItemQuantity(config);

        const inventoryItems = cosmetics.map(c => ({
            lastUpdatedAt: c.lastUpdatedAt || timestamp,
            objectId: c.objectId,
            quantity: 1
        }));

        const existingIds = new Set(inventoryItems.map(i => i.objectId));

        // Inject perks at max tier
        for (const perkId of this.perkIds) {
            if (!existingIds.has(perkId)) {
                inventoryItems.push({ lastUpdatedAt: timestamp, objectId: perkId, quantity: 3 });
                existingIds.add(perkId);
            }
        }

        // Inject items, addons, offerings
        for (const item of this.itemsData) {
            if (!existingIds.has(item.ItemId)) {
                inventoryItems.push({ lastUpdatedAt: timestamp, objectId: item.ItemId, quantity: itemQuantity });
                existingIds.add(item.ItemId);
            }
        }
        for (const addon of this.addonsData) {
            if (!existingIds.has(addon.ItemId)) {
                inventoryItems.push({ lastUpdatedAt: timestamp, objectId: addon.ItemId, quantity: itemQuantity });
                existingIds.add(addon.ItemId);
            }
        }
        for (const offering of this.offeringsData) {
            if (!existingIds.has(offering.ItemId)) {
                inventoryItems.push({ lastUpdatedAt: timestamp, objectId: offering.ItemId, quantity: itemQuantity });
                existingIds.add(offering.ItemId);
            }
        }

        this._shuffle(inventoryItems);
        const result = { inventoryItems };

        // Inject userId if available
        if (this.userId) {
            result.data = {
                playerId: this.userId,
                inventory: []
            };
        }

        return result;
    }

    generateCurrency(config) {
        // Event currencies are spoofed to this amount when the eventCurrencies
        // toggle is on. Defaults preserve old behaviour (match bloodpoints)
        // for installs that don't yet have the new config field.
        const eventEnabled = config.eventCurrencies ? config.eventCurrencies.enabled : true;
        const eventAmount = config.eventCurrencies && typeof config.eventCurrencies.amount === 'number'
            ? config.eventCurrencies.amount
            : config.currency.bloodpoints;

        if (!this.baseCurrency) {
            return {
                list: [
                    { balance: config.currency.bloodpoints, currency: "Bloodpoints" },
                    { balance: config.currency.shards, currency: "Shards" },
                    { balance: config.currency.cells, currency: "Cells" }
                ]
            };
        }

        const currency = this._deepClone(this.baseCurrency);

        // Map user config to currency types
        for (const entry of currency.list) {
            switch (entry.currency) {
                case 'Bloodpoints':
                    entry.balance = config.currency.bloodpoints;
                    break;
                case 'Shards':
                    entry.balance = config.currency.shards;
                    break;
                case 'Cells':
                    entry.balance = config.currency.cells;
                    break;
                case 'BonusBloodpoints':
                case 'USCents':
                    // Leave as-is (0)
                    break;
                default:
                    // Event / seasonal currencies (HalloweenCoins, LunarNewYearCoins,
                    // Keystones, ObsidianBones, Dust, HalloweenEventCurrency, …).
                    // Spoof to the user-chosen amount when the toggle is on; otherwise
                    // leave the original template value untouched.
                    if (eventEnabled) entry.balance = eventAmount;
                    break;
            }
        }

        return currency;
    }

    /**
     * REPLACE-strategy bloodweb response (modelled directly on Cursed Market's
     * FiddlerCore.cs lines 379-422).
     *
     * Why REPLACE, not MERGE:
     *   Our base template (`data/market/Bloodweb.json`) is a fully-spent
     *   bloodweb: every node has `state: "Collected"` across 38 nodes / 5 rings.
     *   That static shape makes the game render a consistent
     *   "max prestige, level 50, nothing left to purchase" screen and stops
     *   polling. The previous merge-style code preserved the live server's
     *   real `bloodWebData.ringData` which, for an already-maxed character,
     *   came back empty/transitional — the game saw "level 50 with no purchasable
     *   nodes" and re-fetched the bloodweb forever (~2 POSTs/sec, 61KB each).
     *
     * What we apply on top of the template per request:
     *   - characterName   ← from the request body so the client renders the
     *                      right character; otherwise it'd render the template's
     *                      empty string and the game UI would freak out.
     *   - prestigeLevel   ← user-configured (or randomised) value, like Cursed
     *                      Market's CharactersPreset behaviour.
     *   - legacyPrestigeLevel ← same as prestigeLevel (DBD treats them in lockstep
     *                          for any character whose legacy never differed).
     *   - bloodWebLevel   ← user-configured value, capital-W (matches the live
     *                      game response). The template ships with the typo-cased
     *                      `bloodwebLevel` (lowercase w) which we delete to avoid
     *                      sending a confusing duplicate key.
     *   - characterItems  ← from our cached generator so each character displays
     *                      the right item stack quantities.
     *
     * The original live-server bwData is otherwise ignored. We always serve a
     * synthetic 200 — even when the live server returned an error (e.g.
     * unowned character). proxy.js already coerces statusCode to 200 in that
     * case before passing data here.
     */
    populateBloodweb(bwData, reqBodyStr, config) {
        // No template loaded? Fall back to minimal merge so we at least
        // don't blow up. Should never happen in normal installs.
        if (!this.baseBloodweb) {
            const fallback = { ...(bwData || {}) };
            try {
                const reqData = reqBodyStr ? JSON.parse(reqBodyStr) : null;
                if (reqData && reqData.characterName) fallback.characterName = reqData.characterName;
            } catch (_) {}
            return fallback;
        }

        const result = this._deepClone(this.baseBloodweb);

        // Resolve character name from the request body.
        let characterName = '';
        if (reqBodyStr) {
            try {
                const reqData = JSON.parse(reqBodyStr);
                if (reqData && typeof reqData.characterName === 'string') {
                    characterName = reqData.characterName;
                }
            } catch (_) {}
        }
        result.characterName = characterName;

        // Apply spoofed prestige + bloodweb level.
        const prestige = this._resolveValue(
            config.characters.prestigeLevel,
            config.characters.prestigeRandomMin,
            config.characters.prestigeRandomMax
        );
        result.prestigeLevel = prestige;
        result.legacyPrestigeLevel = prestige;

        const bwLevel = this._resolveValue(
            config.characters.bloodwebLevel,
            config.characters.bloodwebRandomMin,
            config.characters.bloodwebRandomMax
        );
        result.bloodWebLevel = typeof bwLevel === 'number' ? Math.min(Math.max(bwLevel, 1), 50) : 50;

        // Drop the lowercase typo field from the template (real game uses capital W).
        // Without this we'd send both `bloodwebLevel` (template) and `bloodWebLevel`
        // (our override) — wasted bytes plus a sniffable anomaly.
        if ('bloodwebLevel' in result) delete result.bloodwebLevel;

        // Inject per-character item list from the cache (cheap lookup).
        const charItems = this._getCharacterItemsCached(characterName, config);
        if (charItems && charItems.length > 0) {
            result.characterItems = charItems;
        }

        return result;
    }

    /**
     * Returns the cached characterItems for `characterName` under the current
     * unlock config. Cache key uses the config fields that influence item
     * generation (itemQuantity + characters block). Invalidated automatically
     * when the user changes settings.
     */
    _getCharacterItemsCached(characterName, config) {
        if (!characterName) return null;

        const cacheKey = JSON.stringify({
            itemQuantity: config.itemQuantity,
            characters: config.characters,
        });

        if (!this._charItemsCache || this._charItemsCache.key !== cacheKey) {
            // Build once for ALL characters, then look up.
            const fullProfile = this.generateGetAll(config);
            const map = new Map();
            for (const c of (fullProfile.list || [])) {
                map.set(c.characterName, c.characterItems || []);
            }
            this._charItemsCache = { key: cacheKey, map };
        }

        return this._charItemsCache.map.get(characterName) || null;
    }

    generatePlayerLevel(config) {
        if (!this.baseLevel) {
            return {
                totalXp: 999,
                levelVersion: 249,
                level: config.level.value || 99,
                prestigeLevel: 999,
                currentXp: 999,
                currentXpUpperBound: 4200
            };
        }

        const level = this._deepClone(this.baseLevel);
        level.level = config.level.value || 99;
        return level;
    }

    generateKillswitch() {
        return this.baseKillswitch || [];
    }

    /**
     * Populates the universal inventory (/api/v1/dbd-inventories/all) using a
     * mode-aware merge strategy borrowed from Cursed Market's FiddlerCore.cs
     * (lines 356-376, `E_MarketFilePopulationType`).
     *
     * Why mode-aware:
     *   The DBD UI displays the lobby loadout by reading from BOTH the
     *   per-character `characterItems` (from /get-all) AND the universal
     *   `inventoryItems` (from this endpoint). When the same objectId appears
     *   in both at quantity 9999, the UI sums them and shows 19998. This was
     *   the user-reported "some offerings double" bug. The fix is to inject
     *   each item into only ONE source at a time, gated by match state:
     *
     *     - Out of match (lobby/menu):  characterItems has everything,
     *                                   inventoryItems gets PERKS + COSMETICS only.
     *                                   Loadout selector reads per-char items
     *                                   from characterItems. No doubling.
     *     - In match:                   inventoryItems gets EVERYTHING. The
     *                                   match itself reads from the universal
     *                                   inventory; this overwrite ensures the
     *                                   user has stock for in-match consumption.
     *
     * Other safeguards (carry-over from the previous fix):
     *   1. Dedup the real inventory by objectId — BHVR returns duplicate records
     *      for some items (legacy event grants, twitch drops). Without dedup,
     *      our quantity overwrite touches multiple copies and the UI sums them.
     *   2. Build a single spoof map with category precedence
     *      (perk > consumable > cosmetic) so the 1,121-ID overlap between our
     *      cosmetics baseline and consumables can't double-set.
     *   3. Items NOT in our spoof set keep their real server quantity.
     */
    populateInventory(realResponse, config, isInMatch = false) {
        const result = { ...realResponse };
        if (!Array.isArray(result.inventoryItems)) result.inventoryItems = [];

        const timestamp = Math.floor(Date.now() / 1000);
        const itemQuantity = this._clampedItemQuantity(config);
        // Item injection is gated by ANY of the per-category toggles being on,
        // not just characters.enabled. This lets the user inject perks/items/
        // addons/offerings into their OWNED characters without forcing ALL
        // characters to appear.
        const anyItemCategory = config.characters?.enabled ||
            config.perks?.enabled !== false ||
            config.items?.enabled !== false;
        const charactersEnabled = !!anyItemCategory;
        const cosmeticsEnabled = config.cosmetics && config.cosmetics.enabled;

        // ── Step 1: dedup real inventory by objectId (keep highest quantity) ──
        const realByObjectId = new Map();
        for (const item of result.inventoryItems) {
            if (!item || !item.objectId) continue;
            const prev = realByObjectId.get(item.objectId);
            if (!prev || (item.quantity || 0) > (prev.quantity || 0)) {
                realByObjectId.set(item.objectId, { ...item });
            }
        }

        // ── Step 2: build the spoof map (single source of truth per objectId) ──
        // Precedence: perks > consumables (items/addons/offerings) > cosmetics.
        // Consumables are ALSO gated by `isInMatch` to avoid the universal-
        // inventory <-> characterItems doubling that produced 19998 stacks.
        const spoofMap = new Map();
        const setSpoof = (objectId, quantity, lastUpdatedAt) => {
            if (spoofMap.has(objectId)) return; // higher precedence already won
            spoofMap.set(objectId, { quantity, lastUpdatedAt: lastUpdatedAt || timestamp });
        };

        if (charactersEnabled) {
            const perksEnabled = config.perks?.enabled !== false;
            const itemsEnabled = config.items?.enabled !== false;

            if (perksEnabled) for (const perkId of this.perkIds) setSpoof(perkId, 3, timestamp);
            if (itemsEnabled) {
                for (const item of this.itemsData) setSpoof(item.ItemId, itemQuantity, timestamp);
                for (const addon of this.addonsData) setSpoof(addon.ItemId, itemQuantity, timestamp);
                for (const offering of this.offeringsData) setSpoof(offering.ItemId, itemQuantity, timestamp);
            }
        }
        if (cosmeticsEnabled) {
            // Filter cosmetics down to TRUE cosmetics (skins, charms, badges).
            // 1,121 IDs in cosmeticsBaseline overlap with perks/items/addons/offerings
            // (legacy classification artifact). Injecting those overlaps as qty=1
            // here would either clobber the real server quantity (out of match,
            // when the consumables loop is skipped) or be immediately overwritten
            // by the in-match consumables loop — neither is correct. Skip them.
            for (const c of this.getMergedCosmetics()) {
                const id = c.objectId;
                if (this.perkIds.has(id) || this.itemIds.has(id) ||
                    this.addonIds.has(id) || this.offeringIds.has(id)) continue;
                setSpoof(id, 1, c.lastUpdatedAt || timestamp);
            }
        }

        // ── Step 3: merge — overwrite existing OR append ──
        for (const [objectId, spoof] of spoofMap) {
            const existing = realByObjectId.get(objectId);
            if (existing) {
                // Preserve server's lastUpdatedAt for authenticity; overwrite quantity only.
                existing.quantity = spoof.quantity;
            } else {
                realByObjectId.set(objectId, {
                    lastUpdatedAt: spoof.lastUpdatedAt,
                    objectId,
                    quantity: spoof.quantity,
                });
            }
        }

        result.inventoryItems = Array.from(realByObjectId.values());
        this._shuffle(result.inventoryItems);
        return result;
    }

    /**
     * Rewrite the wallet response served by
     * `/api/v1/extensions/wallet/getLocalizedCurrenciesAfterLogin`.
     *
     * Why this exists separately from `generateCurrency`:
     *   BHVR has TWO wallet endpoints — the old `/api/v1/wallet/currencies`
     *   (which we already intercept wholesale via `generateCurrency`) and
     *   the newer extensions endpoint used by the actual lobby/loadout UI
     *   to render event-offering "remaining uses" counts (Anniversary cakes,
     *   Halloween coins, Lunar tokens etc.). The newer response shape is
     *   `{country, list}` — same `list[]` schema but with a localisation
     *   wrapper. We snoop + modify (rather than wholesale replace) to keep
     *   the country code and any future fields BHVR adds.
     *
     * Effect: an event offering like Toothy Torte costs N units of
     * `AnniversaryEventCurrency` per use. The "remaining uses" displayed on
     * the equipped slot is `floor(currencyBalance / costPerUse)`. If the
     * server says you have 325 and the cost is >325, the slot reads
     * "NONE REMAINING / 0". Spoofing the balance to 999999 (default) makes
     * the slot show maximum uses.
     */
    populateLocalizedWallet(data, config) {
        if (!data || !Array.isArray(data.list)) return data;

        const eventEnabled = config.eventCurrencies ? config.eventCurrencies.enabled : true;
        const eventAmount = config.eventCurrencies && typeof config.eventCurrencies.amount === 'number'
            ? config.eventCurrencies.amount
            : config.currency.bloodpoints;

        for (const entry of data.list) {
            switch (entry.currency) {
                case 'Bloodpoints':
                    entry.balance = config.currency.bloodpoints;
                    break;
                case 'Shards':
                    entry.balance = config.currency.shards;
                    break;
                case 'Cells':
                    entry.balance = config.currency.cells;
                    break;
                case 'BonusBloodpoints':
                case 'USCents':
                case 'HardCurrency':
                    // Leave the server's value untouched — these aren't
                    // user-spendable in the event-offering flow and tampering
                    // can trip BHVR's anomaly detection.
                    break;
                default:
                    // Event / seasonal currencies (AnniversaryEventCurrency,
                    // HalloweenCoins, LunarNewYearCoins, Keystones, ObsidianBones,
                    // Dust, HalloweenEventCurrency, Halloween2018Coins, LunarCoins,
                    // DrawTicket, WinterEventCurrency, SpringEventCurrency, …).
                    // Spoof to the configured amount so event offerings show
                    // maximum remaining uses.
                    if (eventEnabled) entry.balance = eventAmount;
                    break;
            }
        }
        return data;
    }

    generateOnboarding() {
        // Full onboarding completion — skips all tutorials
        return {
            tutorialIds: [],
            featureDiscoveryIds: [],
            hintsDisplayedCounters: {},
            challengesCompleted: true,
            tutorialsCompleted: true,
            lastSeen: new Date().toISOString()
        };
    }

    /**
     * Snoop+merge handler for /dbd-character-data/get-all.
     *
     * Used when "All Characters" is OFF but any of Perks/Items/Addons/Offerings
     * is ON. Lets the REAL server response through (only owned characters) and
     * injects our universal characterItems into each character the server
     * actually returned. Unowned characters stay hidden.
     *
     * IMPORTANT: prestigeLevel and legacyPrestigeLevel are NOT modified here.
     * "All Characters" being OFF means the user explicitly does NOT want their
     * character progression altered — they just want perks/items available on
     * the characters they actually own. Touching prestige in this path caused
     * the "every owned character shows P100 even though All Characters is
     * disabled" bug.
     *
     * Contrast with generateGetAll() which REPLACES the entire response with
     * a fabricated template containing ALL characters at the configured
     * prestige.
     */
    populateGetAll(data, config) {
        if (!data || !Array.isArray(data.list)) return data;

        const result = this._deepClone(data);
        const itemQuantity = this._clampedItemQuantity(config);
        const universalItems = this._buildUniversalCharacterItems(itemQuantity, config);

        for (const character of result.list) {
            // Leave prestigeLevel / legacyPrestigeLevel untouched — preserve
            // the user's real server-side progression. Only inject items.
            // The game UI only shows the items relevant to this character's
            // role, so the universal array is safe to apply to every char.
            character.characterItems = universalItems.slice();
        }

        return result;
    }
}

module.exports = ProfileGenerator;
