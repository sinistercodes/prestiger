# prestiger

A Windows desktop tool for Dead by Daylight that automates prestige progression, item farming, and client-side profile customization via MITM proxy interception of BHVR's live API.

## Features

### Prestige Automation
- **Fast prestige loop** — P0 to P100 in under 5 minutes per character using the bloodweb exploit
- **Adaptive rate limiting** — 1ms base delay with automatic backoff on HTTP 429 (per-character) and 50s cooldown on HTTP 403 (IP-level)
- **Queue system** — batch multiple characters and let the tool run through them sequentially
- **Item sniping** — optionally purchase specific target items (perks, addons, offerings) while prestiging via path-based `operationOrder` PLAYER actor entries
- **Farm mode** — continuous bloodweb farming with "Snipe & Skip" (only target items) or "Snipe & Collect" (grab everything along the path) modes

### Unlock & Customization
- **Items, Addons & Offerings** — inject all consumables into your owned characters at configurable quantities
- **Perks** — all perks at tier 3 (unlocks LEVEL 5/10/15 slots)
- **Cosmetics** — all skins, outfits, and charms from the latest game dump
- **All Characters** — optionally force all characters to appear as owned at max prestige (or leave off to only affect your owned characters)
- **Currency spoof** — Bloodpoints, Shards, Cells, and all event/seasonal currencies
- **Killswitch bypass** — re-enable items and perks disabled by BHVR's killswitch
- **Tutorial skip** — mark all tutorials as completed
- **Region lock** — spoof per-region ping latencies to force matchmaking onto a specific server
- **Player level** — set devotion level and XP

### Quality of Life
- **Loadout persistence** — saves your per-character loadouts (perks, items, addons, offerings, cosmetics) to disk and restores them on every game launch, so you never lose your setups
- **Mystery box auto-claim** — automatically claims the free weekly 250k BP mystery box after login
- **Tome auto-completion** — automatically completes the active tome quest after each match
- **Gamelog blocking** — prevents telemetry from reaching BHVR's analytics pipeline
- **Live BP feed** — polls your current Bloodpoints balance at a steady interval
- **Debug inspector** — full request/response viewer with JSON body inspection, export to file, and request replay/edit/resend
- **Captured header passthrough** — uses the exact headers the game client sends (User-Agent, x-kraken-*, etc.) for all spoofed requests

### API Key Capture
- Built-in MITM HTTPS proxy (node-forge CA generation, per-domain cert minting)
- Auto-installs root certificate to Windows trust store
- Captures `api-key` from auth responses automatically
- Supports Steam, Epic Games, and MS Store (Windows/Xbox) platforms
- Auto-detects which platform the game is running on via process detection

## Requirements

- **Windows 10/11** (proxy uses Windows registry for system proxy configuration)
- **Dead by Daylight** (Steam, Epic, or MS Store version)
- **.NET Framework 4.x** or later (for certutil)
- No admin rights required for normal operation (cert install uses user store)

## Installation

1. Download the latest `prestiger-X.X.X-portable.exe` from [Releases](../../releases)
2. Run it — no installation needed, it's a portable executable
3. Go to the **Proxy** tab and click **Start Proxy**
4. Click **Install Certificate** to trust the MITM CA (user store, no admin needed)
5. Launch Dead by Daylight
6. The tool will automatically capture your session key when the game authenticates

## Usage

### Prestige
1. Go to the **Prestige** tab
2. Select one or more characters
3. Set the number of prestiges (1–100)
4. Click **Start Now** or **Add to Queue**

### Farming / Item Sniping
1. Go to the **Sniper** tab
2. Select a character
3. Click **Select items to snipe** and pick target items
4. Choose mode: **Snipe & Skip** or **Snipe & Collect**
5. Click **Start Farming**

### Unlock All
1. Go to the **Unlock** tab
2. Enable the **Interception Active** master toggle
3. Toggle individual categories (Items, Perks, Cosmetics, Currency, etc.)
4. Configure quantities and prestige levels in the settings panel
5. Restart Dead by Daylight for changes to take effect

### Region Lock
1. Go to **Unlock** tab → enable **Region Lock**
2. Select your preferred region from the dropdown
3. The proxy rewrites the latency table on every matchmaking request

## How It Works

The tool operates as a local HTTPS MITM proxy:

1. **System proxy registration** — writes Windows registry keys to route all HTTP/HTTPS traffic through `127.0.0.1:8888`
2. **TLS interception** — for BHVR domains (`*.live.bhvrdbd.com`), generates per-domain certificates signed by a locally-trusted CA
3. **Request interception** — for specific endpoints, generates synthetic responses (unlock-all data, currency, bloodweb)
4. **Response modification** — for other endpoints, lets the real server response through but modifies specific fields (inventory quantities, prestige levels, bloodweb items)
5. **Request body modification** — rewrites outgoing request bodies (ping spoofing for region lock)
6. **Out-of-band API calls** — makes direct API calls to BHVR for prestige automation, farming, mystery box claiming, and tome completion

All spoofed traffic uses headers captured from the live game client (User-Agent, x-kraken-client-version, etc.) so the requests are indistinguishable from real game traffic.

## Tech Stack

- **Electron 33** — desktop app framework
- **Node.js** — backend (proxy, engines, API client)
- **React 19 + Vite + TypeScript** — renderer UI
- **Tailwind CSS + Radix UI** — styling and components
- **node-forge** — CA certificate generation and TLS interception
- **axios** — HTTP client for BHVR API calls
- **Melancholy** — game data extraction (items, addons, offerings, perks, cosmetics from .pak files)

## Data Sources

Game data files (`data/*.json`) are generated by [Melancholy](https://github.com/OssieFromDK/Melancholy) from the game's `.pak` archives using a `.usmap` mapping file and AES key.

## Configuration

All settings are persisted at `~/.prestiger/`:
- `unlock-config.json` — unlock/fabrication settings
- `tomes-config.json` — tome auto-completion toggle
- `loadouts/` — per-character loadout saves
- `cosmetics-cache.json` — cached live cosmetics
- `certs/` — CA certificate and private key
- `player-card.json` — saved badge/banner preset

## Disclaimer

This tool interacts with BHVR's undocumented API. Use at your own risk. The developers are not responsible for any consequences including but not limited to account bans, data loss, or terms-of-service violations.
