import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Shield, ShieldCheck, Shuffle, Lock, Unlock, Coins, User, Shirt, Swords, Zap, GraduationCap, EyeOff, Globe2, Star, Package } from 'lucide-react'

// BHVR's matchmaking regions (from /api/v1/config GAMELIFT_ENDPOINTS).
const REGIONS: Array<{ id: string; label: string }> = [
  { id: 'eu-west-1',      label: 'Ireland (EU West)' },
  { id: 'eu-west-2',      label: 'London (EU West 2)' },
  { id: 'eu-central-1',   label: 'Frankfurt (EU Central)' },
  { id: 'us-east-1',      label: 'N. Virginia (US East)' },
  { id: 'us-east-2',      label: 'Ohio (US East 2)' },
  { id: 'us-west-1',      label: 'N. California (US West)' },
  { id: 'us-west-2',      label: 'Oregon (US West 2)' },
  { id: 'ca-central-1',   label: 'Canada (Central)' },
  { id: 'sa-east-1',      label: 'São Paulo (S. America)' },
  { id: 'ap-northeast-1', label: 'Tokyo (AP NE)' },
  { id: 'ap-northeast-2', label: 'Seoul (AP NE 2)' },
  { id: 'ap-southeast-1', label: 'Singapore (AP SE)' },
  { id: 'ap-southeast-2', label: 'Sydney (AP SE 2)' },
  { id: 'ap-south-1',     label: 'Mumbai (AP South)' },
  { id: 'ap-east-1',      label: 'Hong Kong (AP East)' },
]
import { cn } from '@/lib/utils'
import type { UnlockConfig } from '@/hooks/use-app-store'

interface UnlockTabProps {
  config: UnlockConfig
  onConfigChange: (config: UnlockConfig) => void
  proxyActive: boolean
}

export default function UnlockTab({ config, onConfigChange, proxyActive }: UnlockTabProps) {
  const [cosmeticsInfo, setCosmeticsInfo] = useState<{ count: number; lastUpdated: string | null; hasLiveData: boolean } | null>(null)

  useEffect(() => {
    window.api.getCosmeticsData().then(setCosmeticsInfo)
  }, [])

  const update = (patch: Partial<UnlockConfig>) => {
    const next = { ...config, ...patch }
    onConfigChange(next)
    window.api.setUnlockConfig(next)
  }

  const updateCharacters = (patch: Partial<UnlockConfig['characters']>) => {
    update({ characters: { ...config.characters, ...patch } })
  }

  const updateCurrency = (patch: Partial<UnlockConfig['currency']>) => {
    update({ currency: { ...config.currency, ...patch } })
  }

  const updateLevel = (patch: Partial<UnlockConfig['level']>) => {
    update({ level: { ...config.level, ...patch } })
  }

  const enabledCount = [
    config.characters.enabled, config.perks?.enabled, config.items?.enabled,
    config.cosmetics.enabled, config.currency.enabled, config.level.enabled,
    config.killswitch?.enabled, config.tutorials?.enabled, config.blockGamelogs?.enabled,
    config.pingSpoof?.enabled,
  ].filter(Boolean).length

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-4 h-full p-4">
      {/* Left: Master + Category Toggles */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border">
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Unlock Configuration
          </h2>
        </div>
        <div className="flex-1 p-4 space-y-3 overflow-y-auto">
          {/* Master toggle */}
          <div className={cn(
            "flex items-center justify-between p-3 rounded-sm transition-colors",
            config.enabled ? "bg-foreground/[0.06]" : "bg-secondary/50"
          )}>
            <div className="flex items-center gap-3">
              {config.enabled ? (
                <ShieldCheck className="h-5 w-5 text-foreground" />
              ) : (
                <Shield className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <div className="text-sm font-medium">
                  {config.enabled ? 'Interception Active' : 'Interception Off'}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {config.enabled
                    ? `${enabledCount} categor${enabledCount === 1 ? 'y' : 'ies'} enabled`
                    : 'Enable to intercept API responses'
                  }
                </div>
              </div>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
              disabled={!proxyActive}
            />
          </div>

          {!proxyActive && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-sm bg-secondary/30 text-[10px] text-muted-foreground">
              <Lock className="h-3 w-3 shrink-0" />
              Start the proxy first to enable interception
            </div>
          )}

          {/* Category toggles */}
          <div className="space-y-1">
            {[
              {
                icon: Swords,
                label: 'All Characters',
                desc: 'Force ALL characters to appear as owned + max prestige',
                enabled: config.characters.enabled,
                onToggle: (v: boolean) => updateCharacters({ enabled: v }),
              },
              {
                icon: Star,
                label: 'Perks',
                desc: 'All perks at tier 3 for every character',
                enabled: config.perks?.enabled ?? true,
                onToggle: (v: boolean) => update({ perks: { enabled: v } }),
              },
              {
                icon: Package,
                label: 'Items, Addons & Offerings',
                desc: 'All consumables (toolboxes, medkits, addons, moris, cakes)',
                enabled: config.items?.enabled ?? true,
                onToggle: (v: boolean) => update({ items: { enabled: v } }),
              },
              {
                icon: Shirt,
                label: 'Cosmetics',
                desc: cosmeticsInfo ? `${cosmeticsInfo.count.toLocaleString()} skins${cosmeticsInfo.hasLiveData ? ' + live' : ''}` : 'All outfits & skins',
                enabled: config.cosmetics.enabled,
                onToggle: (v: boolean) => update({ cosmetics: { enabled: v } }),
              },
              {
                icon: Coins,
                label: 'Currency',
                desc: 'Bloodpoints, Shards, Cells',
                enabled: config.currency.enabled,
                onToggle: (v: boolean) => updateCurrency({ enabled: v }),
              },
              {
                icon: User,
                label: 'Player Level',
                desc: 'Devotion level & XP',
                enabled: config.level.enabled,
                onToggle: (v: boolean) => updateLevel({ enabled: v }),
              },
              {
                icon: Zap,
                label: 'Killswitch Bypass',
                desc: 'Re-enable disabled items & perks',
                enabled: config.killswitch?.enabled ?? false,
                onToggle: (v: boolean) => update({ killswitch: { enabled: v } }),
              },
              {
                icon: GraduationCap,
                label: 'Skip Tutorials',
                desc: 'Mark all tutorials as completed',
                enabled: config.tutorials?.enabled ?? false,
                onToggle: (v: boolean) => update({ tutorials: { enabled: v } }),
              },
              {
                icon: EyeOff,
                label: 'Block Gamelogs',
                desc: 'Prevent telemetry & logging',
                enabled: config.blockGamelogs?.enabled ?? false,
                onToggle: (v: boolean) => update({ blockGamelogs: { enabled: v } }),
              },
              {
                icon: Globe2,
                label: 'Region Lock',
                desc: 'Spoof ping to force a specific server region',
                enabled: config.pingSpoof?.enabled ?? false,
                onToggle: (v: boolean) => update({
                  pingSpoof: {
                    region: config.pingSpoof?.region ?? 'eu-west-1',
                    goodLatency: config.pingSpoof?.goodLatency ?? 20,
                    badLatency: config.pingSpoof?.badLatency ?? 999,
                    enabled: v,
                  }
                }),
              },
            ].map(({ icon: Icon, label, desc, enabled, onToggle }) => (
              <button
                key={label}
                onClick={() => onToggle(!enabled)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-left transition-colors",
                  enabled ? "bg-foreground/[0.04]" : "hover:bg-secondary/40"
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", enabled ? "text-foreground" : "text-muted-foreground/60")} />
                <div className="flex-1 min-w-0">
                  <div className={cn("text-xs font-medium", !enabled && "text-muted-foreground")}>{label}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">{desc}</div>
                </div>
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0 transition-colors",
                  enabled ? "bg-foreground" : "bg-muted-foreground/30"
                )} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Settings for enabled categories */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border">
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Settings
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!config.characters.enabled && !config.items?.enabled && !config.currency.enabled &&
           !config.level.enabled && !config.pingSpoof?.enabled ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="text-center">
                <Unlock className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground/50">Enable a category to configure</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* Character settings — show when All Characters is ON */}
              {config.characters.enabled && (
                <div className="p-4 space-y-4">
                  <h3 className="font-display text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-2">
                    <Swords className="h-3 w-3" />
                    All Characters
                  </h3>

                  {/* Prestige */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Prestige</label>
                      {config.characters.prestigeLevel === 'random' ? (
                        <Badge variant="secondary" className="text-[9px] h-4 gap-1">
                          <Shuffle className="h-2.5 w-2.5" />
                          {config.characters.prestigeRandomMin ?? 0}–{config.characters.prestigeRandomMax ?? 100}
                        </Badge>
                      ) : (
                        <span className="text-xs font-mono tabular-nums">{config.characters.prestigeLevel}</span>
                      )}
                    </div>
                    <div className="flex gap-2 items-center">
                      {config.characters.prestigeLevel !== 'random' ? (
                        <Slider
                          value={[config.characters.prestigeLevel as number]}
                          min={0} max={100} step={1}
                          onValueChange={([v]) => updateCharacters({ prestigeLevel: v })}
                          className="flex-1"
                        />
                      ) : (
                        <div className="flex-1 flex gap-2 items-center">
                          <Input
                            type="number" min={0} max={100}
                            value={config.characters.prestigeRandomMin ?? 0}
                            onChange={(e) => updateCharacters({ prestigeRandomMin: parseInt(e.target.value) || 0 })}
                            className="h-7 w-16 text-xs text-center bg-secondary/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <div className="h-px flex-1 bg-border" />
                          <Input
                            type="number" min={0} max={100}
                            value={config.characters.prestigeRandomMax ?? 100}
                            onChange={(e) => updateCharacters({ prestigeRandomMax: parseInt(e.target.value) || 100 })}
                            className="h-7 w-16 text-xs text-center bg-secondary/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                      )}
                      <button
                        onClick={() => {
                          if (config.characters.prestigeLevel === 'random') {
                            updateCharacters({ prestigeLevel: 100 })
                          } else {
                            updateCharacters({ prestigeLevel: 'random', prestigeRandomMin: 50, prestigeRandomMax: 100 })
                          }
                        }}
                        className={cn(
                          "h-7 w-7 shrink-0 rounded-sm flex items-center justify-center transition-colors",
                          config.characters.prestigeLevel === 'random'
                            ? "bg-foreground/10 text-foreground"
                            : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                        )}
                        title="Randomize"
                      >
                        <Shuffle className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {/* Bloodweb */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Bloodweb</label>
                      {config.characters.bloodwebLevel === 'random' ? (
                        <Badge variant="secondary" className="text-[9px] h-4 gap-1">
                          <Shuffle className="h-2.5 w-2.5" />
                          {config.characters.bloodwebRandomMin ?? 1}–{config.characters.bloodwebRandomMax ?? 50}
                        </Badge>
                      ) : (
                        <span className="text-xs font-mono tabular-nums">{config.characters.bloodwebLevel}</span>
                      )}
                    </div>
                    <div className="flex gap-2 items-center">
                      {config.characters.bloodwebLevel !== 'random' ? (
                        <Slider
                          value={[config.characters.bloodwebLevel as number]}
                          min={1} max={50} step={1}
                          onValueChange={([v]) => updateCharacters({ bloodwebLevel: v })}
                          className="flex-1"
                        />
                      ) : (
                        <div className="flex-1 flex gap-2 items-center">
                          <Input
                            type="number" min={1} max={50}
                            value={config.characters.bloodwebRandomMin ?? 1}
                            onChange={(e) => updateCharacters({ bloodwebRandomMin: parseInt(e.target.value) || 1 })}
                            className="h-7 w-16 text-xs text-center bg-secondary/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <div className="h-px flex-1 bg-border" />
                          <Input
                            type="number" min={1} max={50}
                            value={config.characters.bloodwebRandomMax ?? 50}
                            onChange={(e) => updateCharacters({ bloodwebRandomMax: parseInt(e.target.value) || 50 })}
                            className="h-7 w-16 text-xs text-center bg-secondary/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                      )}
                      <button
                        onClick={() => {
                          if (config.characters.bloodwebLevel === 'random') {
                            updateCharacters({ bloodwebLevel: 50 })
                          } else {
                            updateCharacters({ bloodwebLevel: 'random', bloodwebRandomMin: 1, bloodwebRandomMax: 50 })
                          }
                        }}
                        className={cn(
                          "h-7 w-7 shrink-0 rounded-sm flex items-center justify-center transition-colors",
                          config.characters.bloodwebLevel === 'random'
                            ? "bg-foreground/10 text-foreground"
                            : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                        )}
                        title="Randomize"
                      >
                        <Shuffle className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                </div>
              )}

              {/* Items, Addons & Offerings settings — show when that toggle is ON */}
              {config.items?.enabled && (
                <div className="p-4 space-y-3">
                  <h3 className="font-display text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-2">
                    <Package className="h-3 w-3" />
                    Items, Addons & Offerings
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Item Qty</label>
                      <span className="text-xs font-mono tabular-nums">{config.itemQuantity}</span>
                    </div>
                    <Slider
                      value={[config.itemQuantity]}
                      min={1} max={999} step={1}
                      onValueChange={([v]) => update({ itemQuantity: v })}
                    />
                  </div>
                </div>
              )}

              {/* Currency settings */}
              {config.currency.enabled && (
                <div className="p-4 space-y-3">
                  <h3 className="font-display text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-2">
                    <Coins className="h-3 w-3" />
                    Currency
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { key: 'bloodpoints' as const, label: 'BP' },
                      { key: 'shards' as const, label: 'Shards' },
                      { key: 'cells' as const, label: 'Cells' },
                    ]).map(({ key, label }) => (
                      <div key={key} className="space-y-1">
                        <label className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground block text-center">{label}</label>
                        <Input
                          type="number" min={0}
                          value={config.currency[key]}
                          onChange={(e) => updateCurrency({ [key]: parseInt(e.target.value) || 0 })}
                          className="h-8 text-xs text-center bg-secondary/50 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Event currencies — Halloween, Lunar New Year, Keystones, etc. */}
                  <div className="pt-2 border-t border-border/40 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium">Event Currencies</div>
                        <div className="text-[9px] text-muted-foreground mt-0.5">
                          Halloween, LunarNewYear, Keystones, ObsidianBones, Dust, …
                        </div>
                      </div>
                      <Switch
                        checked={config.eventCurrencies?.enabled ?? true}
                        onCheckedChange={(enabled) => update({
                          eventCurrencies: { ...(config.eventCurrencies ?? { amount: 999999 }), enabled }
                        })}
                      />
                    </div>
                    {(config.eventCurrencies?.enabled ?? true) && (
                      <div className="flex items-center gap-2">
                        <label className="text-[9px] uppercase tracking-wider text-muted-foreground shrink-0">Amount</label>
                        <Input
                          type="number" min={0}
                          value={config.eventCurrencies?.amount ?? 999999}
                          onChange={(e) => update({
                            eventCurrencies: {
                              enabled: config.eventCurrencies?.enabled ?? true,
                              amount: parseInt(e.target.value) || 0,
                            }
                          })}
                          className="h-7 flex-1 text-xs text-center bg-secondary/50 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Player Level settings */}
              {config.level.enabled && (
                <div className="p-4 space-y-3">
                  <h3 className="font-display text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-2">
                    <User className="h-3 w-3" />
                    Player Level
                  </h3>
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Level</label>
                    <Input
                      type="number" min={1} max={999}
                      value={config.level.value}
                      onChange={(e) => updateLevel({ value: parseInt(e.target.value) || 1 })}
                      className="h-8 w-24 text-xs text-center bg-secondary/50 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
              )}

              {/* Region Lock / Ping Spoof settings */}
              {config.pingSpoof?.enabled && (
                <div className="p-4 space-y-3">
                  <h3 className="font-display text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-2">
                    <Globe2 className="h-3 w-3" />
                    Region Lock
                  </h3>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block">Preferred region</label>
                    <Select
                      value={config.pingSpoof.region}
                      onValueChange={(v) => update({ pingSpoof: { ...config.pingSpoof!, region: v } })}
                    >
                      <SelectTrigger
                        className="w-full h-8 bg-secondary/50 border border-border rounded-sm px-2 text-xs font-mono outline-none ring-offset-0 focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none data-[state=open]:bg-secondary/70"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-[320px]">
                        {REGIONS.map(r => (
                          <SelectItem key={r.id} value={r.id} className="text-xs font-mono">
                            <span className="text-foreground">{r.id}</span>
                            <span className="text-muted-foreground"> — {r.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground block text-center">Good ms</label>
                      <Input
                        type="number" min={1} max={9999}
                        value={config.pingSpoof.goodLatency}
                        onChange={(e) => update({ pingSpoof: { ...config.pingSpoof!, goodLatency: parseInt(e.target.value) || 20 } })}
                        className="h-8 text-xs text-center bg-secondary/50 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground block text-center">Bad ms</label>
                      <Input
                        type="number" min={1} max={9999}
                        value={config.pingSpoof.badLatency}
                        onChange={(e) => update({ pingSpoof: { ...config.pingSpoof!, badLatency: parseInt(e.target.value) || 999 } })}
                        className="h-8 text-xs text-center bg-secondary/50 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Rewrites the per-region latency table the game sends to BHVR's matchmaker.
                    Your preferred region keeps the "good" value; every other region gets the "bad" value
                    so BHVR's lobby-stitcher won't route you there. Requires the proxy to be running.
                  </p>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
