import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Play, Square, Search, Crosshair } from 'lucide-react'
import ItemSniperModal from './ItemSniperModal'
import CharacterMultiSelect from './CharacterMultiSelect'
import type { FarmStats } from '@/hooks/use-app-store'

interface SniperTabProps {
  survivors: Character[]
  killers: Character[]
  bhvrSession: string
  onBhvrSessionChange: (v: string) => void
  platform: string
  isFarming: boolean
  isPrestiging: boolean
  farmStats: FarmStats
  onStartFarm: (config: { characterId: string; sniperConfig: string[]; mode: string }) => void
  onStopFarm: () => void
  onAutoDetect: () => void
}

export default function SniperTab({
  survivors,
  killers,
  bhvrSession,
  onBhvrSessionChange,
  platform,
  isFarming,
  isPrestiging,
  farmStats,
  onStartFarm,
  onStopFarm,
  onAutoDetect,
}: SniperTabProps) {
  const [selectedCharacter, setSelectedCharacter] = useState('')
  const [sniperConfig, setSniperConfig] = useState<string[]>([])
  const [sniperOpen, setSniperOpen] = useState(false)
  const [mode, setMode] = useState<'skip' | 'collect'>('skip')
  const [detecting, setDetecting] = useState(false)

  const allChars = [...survivors, ...killers]
  const selectedChar = allChars.find(c => c.id === selectedCharacter)
  const charType = selectedChar
    ? survivors.some(s => s.id === selectedChar.id) ? 'Survivor' : 'Killer'
    : null

  const isValid = bhvrSession.trim() && selectedCharacter && sniperConfig.length > 0

  const handleAutoDetect = async () => {
    setDetecting(true)
    await onAutoDetect()
    setDetecting(false)
  }

  const handleStart = () => {
    if (!isValid || isFarming || isPrestiging) return
    onStartFarm({
      characterId: selectedCharacter,
      sniperConfig,
      mode,
    })
  }

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-4 h-full p-4">
      {/* Left: Configuration */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border">
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Farm Configuration
          </h2>
        </div>
        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Session Cookie</label>
            <div className="flex gap-2">
              <Input
                value={bhvrSession}
                onChange={(e) => onBhvrSessionChange(e.target.value)}
                placeholder="Paste or auto-detect..."
                className="h-9 bg-secondary/50 border-border text-sm font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-9 shrink-0 text-xs gap-1.5 bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
                onClick={handleAutoDetect}
                disabled={detecting}
              >
                <Search className="h-3 w-3" />
                {detecting ? '...' : 'Auto'}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Character</label>
            <CharacterMultiSelect
              survivors={survivors}
              killers={killers}
              selected={selectedCharacter ? [selectedCharacter] : []}
              onSelectionChange={(ids) => {
                const newId = ids.find(id => id !== selectedCharacter) || ids[0] || ''
                setSelectedCharacter(newId)
                if (newId !== selectedCharacter) setSniperConfig([])
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Target Items</label>
            <Button
              variant="outline"
              size="sm"
              className="w-full h-9 text-xs gap-1.5 justify-start"
              onClick={() => setSniperOpen(true)}
              disabled={!selectedCharacter}
            >
              <Crosshair className="h-3 w-3" />
              {sniperConfig.length > 0 ? `${sniperConfig.length} item(s) selected` : 'Select items to snipe...'}
            </Button>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Farming Mode</label>
            <div className="flex gap-2">
              {([
                { value: 'skip', label: 'Snipe & Skip', desc: 'Only target items' },
                { value: 'collect', label: 'Snipe & Collect', desc: 'Collect along path' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setMode(opt.value)}
                  className={`flex-1 px-3 py-2 rounded-sm text-left transition-colors border ${
                    mode === opt.value
                      ? 'bg-primary/10 border-primary/50'
                      : 'bg-secondary/30 border-border hover:bg-secondary/50'
                  }`}
                >
                  <div className="text-[11px] font-semibold">{opt.label}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <Separator className="bg-border/50" />

          <div className="pt-2">
            {isFarming ? (
              <Button
                size="sm"
                variant="destructive"
                className="w-full text-xs gap-1.5 h-9"
                onClick={onStopFarm}
              >
                <Square className="h-3 w-3" />
                Stop Farming
              </Button>
            ) : (
              <Button
                size="sm"
                className="w-full text-xs gap-1.5 h-9 bg-primary hover:bg-primary/90"
                disabled={!isValid || isPrestiging}
                onClick={handleStart}
              >
                <Play className="h-3 w-3" />
                Start Farming
              </Button>
            )}
            {isPrestiging && (
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">Prestige is running — stop it first</p>
            )}
          </div>
        </div>
      </div>

      {/* Right: Live Stats */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border">
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Farm Stats
          </h2>
        </div>
        <div className="flex-1 flex flex-col">
          {!isFarming && farmStats.snipedCount === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-muted-foreground/50">Idle</p>
            </div>
          ) : (
            <>
              <div className="flex-1 p-4 space-y-3 overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Items Sniped', value: farmStats.snipedCount },
                    { label: 'Bloodwebs', value: farmStats.bloodwebsProcessed },
                    { label: 'BP Spent', value: farmStats.bloodpointsSpent.toLocaleString() },
                    { label: 'Status', value: isFarming ? 'Running' : 'Stopped' },
                  ].map(stat => (
                    <div key={stat.label} className="bg-secondary/30 rounded-sm px-3 py-2">
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-display">{stat.label}</div>
                      <div className="text-sm font-semibold font-mono mt-0.5">{stat.value}</div>
                    </div>
                  ))}
                </div>

                {Object.keys(farmStats.snipedItems).length > 0 && (
                  <>
                    <Separator className="bg-border/50" />
                    <div className="space-y-1">
                      <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Sniped Items</h3>
                      {Object.entries(farmStats.snipedItems).map(([name, count]) => (
                        <div key={name} className="flex items-center justify-between text-xs py-1">
                          <span className="truncate mr-2">{name}</span>
                          <Badge variant="secondary" className="text-[9px] h-4 px-1.5 shrink-0">x{count}</Badge>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <ItemSniperModal
        open={sniperOpen}
        onOpenChange={setSniperOpen}
        selected={sniperConfig}
        onSelectedChange={setSniperConfig}
        characterType={charType as 'Survivor' | 'Killer' | null}
      />
    </div>
  )
}
