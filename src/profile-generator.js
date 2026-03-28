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

    // ── Profile Generators ──
    // These clone the actual MarketFiles templates and modify prestige/quantities/userId.
    // This matches how Fortnite Burger works — serve the real files, just tweak values.

    generateGetAll(config) {
        if (!this.baseProfile) return { list: [] };

        const profile = this._deepClone(this.baseProfile);
        const itemQuantity = config.itemQuantity || 100;

        // Determine which character IDs are survivors vs killers
        // Character IDs starting with S or named survivor names = survivor
        // Character IDs starting with K or named killer names = killer
        const { SURVIVORS, KILLERS } = require('./data');
        const survivorIds = new Set(SURVIVORS.map(s => s.id));
        const killerIds = new Set(KILLERS.map(k => k.id));

        for (const character of profile.list) {
            const charId = character.characterName;
            const isSurvivor = survivorIds.has(charId);

            // Set prestige level per character
            const prestige = this._resolveValue(
                config.characters.prestigeLevel,
                config.characters.prestigeRandomMin,
                config.characters.prestigeRandomMax
            );
            character.prestigeLevel = prestige;
            if ('legacyPrestigeLevel' in character) {
                character.legacyPrestigeLevel = prestige;
            }

            // Build a set of existing item IDs to avoid duplicates
            if (!character.characterItems) character.characterItems = [];
            const existingIds = new Set(character.characterItems.map(i => i.itemId));

            // Inject missing items from our data files
            // Items (survivors only)
            if (isSurvivor) {
                for (const item of this.itemsData) {
                    if (!existingIds.has(item.ItemId)) {
                        character.characterItems.push({ itemId: item.ItemId, quantity: itemQuantity });
                        existingIds.add(item.ItemId);
                    }
                }
            }

            // Addons — match by character role
            for (const addon of this.addonsData) {
                if (existingIds.has(addon.ItemId)) continue;
                const isSurvivorAddon = addon.CharacterType === 'EPlayerRole::VE_Camper';
                if (isSurvivor === isSurvivorAddon) {
                    character.characterItems.push({ itemId: addon.ItemId, quantity: itemQuantity });
                    existingIds.add(addon.ItemId);
                }
            }

            // Offerings — universal + role-specific
            for (const offering of this.offeringsData) {
                if (existingIds.has(offering.ItemId)) continue;
                const isUniversal = offering.CharacterType === 'EPlayerRole::VE_None';
                const isSurvivorOffering = offering.CharacterType === 'EPlayerRole::VE_Camper';
                if (isUniversal || isSurvivor === isSurvivorOffering) {
                    character.characterItems.push({ itemId: offering.ItemId, quantity: itemQuantity });
                    existingIds.add(offering.ItemId);
                }
            }

            // Set quantities: perks = 3 (max tier), everything else = itemQuantity
            // Perks are identified by NOT matching consumable patterns
            for (const item of character.characterItems) {
                item.quantity = this._isPerk(item.itemId) ? 3 : itemQuantity;
            }

            this._shuffle(character.characterItems);
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
        const itemQuantity = config.itemQuantity || 100;

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

        // Modify character item quantities
        if (bloodweb.characterItems) {
            for (const item of bloodweb.characterItems) {
                item.quantity = itemQuantity;
            }
        }

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
        const itemQuantity = config.itemQuantity || 50;

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
                    // Event currencies — set to bloodpoints value for max
                    entry.balance = config.currency.bloodpoints;
                    break;
            }
        }

        return currency;
    }

    /**
     * Modifies a bloodweb response: sets prestige/level, injects characterItems.
     * Works on both real server responses (success) and our generated templates (error fallback).
     */
    populateBloodweb(bwData, reqBodyStr, config) {
        const result = { ...bwData };
        const itemQuantity = config.itemQuantity || 50;

        // Get character name from the request body
        let characterName = result.characterName || '';
        if (reqBodyStr) {
            try {
                const reqData = JSON.parse(reqBodyStr);
                if (reqData.characterName) {
                    characterName = reqData.characterName;
                    result.characterName = characterName;
                }
            } catch (_) {}
        }

        // Set prestige and bloodweb level
        result.prestigeLevel = this._resolveValue(
            config.characters.prestigeLevel,
            config.characters.prestigeRandomMin,
            config.characters.prestigeRandomMax
        );
        if ('legacyPrestigeLevel' in result) {
            result.legacyPrestigeLevel = result.prestigeLevel;
        }

        const bwLevel = this._resolveValue(
            config.characters.bloodwebLevel,
            config.characters.bloodwebRandomMin,
            config.characters.bloodwebRandomMax
        );
        result.bloodWebLevel = typeof bwLevel === 'number' ? Math.min(Math.max(bwLevel, 1), 50) : 50;

        // Inject characterItems from our generated get-all data for this character
        const fullProfile = this.generateGetAll(config);
        const charData = fullProfile.list.find(c => c.characterName === characterName);
        if (charData && charData.characterItems) {
            result.characterItems = charData.characterItems;
        }

        return result;
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
     * Populates a real inventory response based on enabled config categories.
     * Only injects items for categories that are actually enabled.
     */
    populateInventory(realResponse, config) {
        const result = { ...realResponse };
        if (!result.inventoryItems) result.inventoryItems = [];

        const timestamp = Math.floor(Date.now() / 1000);
        const itemQuantity = config.itemQuantity || 50;
        const charactersEnabled = config.characters && config.characters.enabled;
        const cosmeticsEnabled = config.cosmetics && config.cosmetics.enabled;

        const cosmeticIds = new Set(this.getMergedCosmetics().map(c => c.objectId));
        const existingIds = new Set(result.inventoryItems.map(i => i.objectId));

        // Inject cosmetics only if cosmetics category is enabled
        if (cosmeticsEnabled) {
            for (const c of this.getMergedCosmetics()) {
                if (!existingIds.has(c.objectId)) {
                    result.inventoryItems.push({ lastUpdatedAt: c.lastUpdatedAt || timestamp, objectId: c.objectId, quantity: 1 });
                    existingIds.add(c.objectId);
                }
            }
        }

        // Inject perks, items, addons, offerings only if characters category is enabled
        if (charactersEnabled) {
            for (const perkId of this.perkIds) {
                if (!existingIds.has(perkId)) {
                    result.inventoryItems.push({ lastUpdatedAt: timestamp, objectId: perkId, quantity: 3 });
                    existingIds.add(perkId);
                }
            }

            for (const item of this.itemsData) {
                if (!existingIds.has(item.ItemId)) {
                    result.inventoryItems.push({ lastUpdatedAt: timestamp, objectId: item.ItemId, quantity: itemQuantity });
                    existingIds.add(item.ItemId);
                }
            }
            for (const addon of this.addonsData) {
                if (!existingIds.has(addon.ItemId)) {
                    result.inventoryItems.push({ lastUpdatedAt: timestamp, objectId: addon.ItemId, quantity: itemQuantity });
                    existingIds.add(addon.ItemId);
                }
            }
            for (const offering of this.offeringsData) {
                if (!existingIds.has(offering.ItemId)) {
                    result.inventoryItems.push({ lastUpdatedAt: timestamp, objectId: offering.ItemId, quantity: itemQuantity });
                    existingIds.add(offering.ItemId);
                }
            }

            // Set correct quantities for injected items
            for (const item of result.inventoryItems) {
                const id = item.objectId;
                if (this.perkIds.has(id)) {
                    item.quantity = 3;
                } else if (this._isConsumable(id)) {
                    item.quantity = itemQuantity;
                } else if (cosmeticIds.has(id)) {
                    item.quantity = 1;
                }
            }
        }

        this._shuffle(result.inventoryItems);
        return result;
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
}

module.exports = ProfileGenerator;
