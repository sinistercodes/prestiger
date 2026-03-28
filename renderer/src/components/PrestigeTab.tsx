import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import CharacterMultiSelect from './CharacterMultiSelect'
import { Play, Plus, Search } from 'lucide-react'
import type { QueueItem } from '@/hooks/use-app-store'

interface PrestigeTabProps {
  survivors: Character[]
  killers: Character[]
  selectedCharacters: string[]
  onSelectedCharactersChange: (ids: string[]) => void
  bhvrSession: string
  onBhvrSessionChange: (v: string) => void
  prestigeCount: number
  onPrestigeCountChange: (v: number) => void
  onAddToQueue: () => void
  onStartDirect: () => void
  onAutoDetect: () => void
  onCancel: () => void
  isPrestiging: boolean
  activeItem?: QueueItem
}

export default function PrestigeTab({
  survivors,
  killers,
  selectedCharacters,
  onSelectedCharactersChange,
  bhvrSession,
  onBhvrSessionChange,
  prestigeCount,
  onPrestigeCountChange,
  onAddToQueue,
  onStartDirect,
  onAutoDetect,
  onCancel,
  isPrestiging,
  activeItem,
}: PrestigeTabProps) {
  const [detecting, setDetecting] = useState(false)
  const isValid = bhvrSession.trim() && selectedCharacters.length > 0 && prestigeCount > 0
  const charCount = Math.max(selectedCharacters.length, 1)
  const estimatedBP = (charCount * prestigeCount * 20000).toLocaleString()

  const handleAutoDetect = async () => {
    setDetecting(true)
    await onAutoDetect()
    setDetecting(false)
  }

  const progress = activeItem?.progress

  // Calculate progress based on individual levels (50 levels per prestige)
  // Level 51 = prestige complete, so each prestige is 51 steps
  const progressPct = (() => {
    if (!progress || progress.totalTarget <= 0) return 0
    const totalLevels = progress.totalTarget * 51
    const completedPrestiges = Math.max(progress.prestigesDone - 1, 0)
    const completedLevels = completedPrestiges * 51 + Math.min(progress.bloodWebLevel, 51)
    return Math.min((completedLevels / totalLevels) * 100, 100)
  })()

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-4 h-full p-4">
      {/* Left: Configuration */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border">
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Configuration
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
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Characters</label>
            <CharacterMultiSelect
              survivors={survivors}
              killers={killers}
              selected={selectedCharacters}
              onSelectionChange={onSelectedCharactersChange}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Prestiges per Character</label>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={100}
                value={prestigeCount}
                onChange={(e) => onPrestigeCountChange(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                className="h-9 w-24 bg-secondary/50 border-border text-sm text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-xs text-muted-foreground font-mono">~{estimatedBP} BP</span>
            </div>
          </div>

          <Separator className="bg-border/50" />

          <div className="flex flex-col gap-2 pt-2">
            <Button
              size="sm"
              className="w-full text-xs gap-1.5 h-9 bg-primary hover:bg-primary/90"
              disabled={!isValid || isPrestiging}
              onClick={onStartDirect}
            >
              <Play className="h-3 w-3" />
              Start Now
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs gap-1.5 h-9"
              disabled={!isValid}
              onClick={onAddToQueue}
            >
              <Plus className="h-3 w-3" />
              Add to Queue
            </Button>
          </div>
        </div>
      </div>

      {/* Right: Progress */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Progress
          </h2>
          {activeItem && (
            <button
              onClick={onCancel}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="flex-1 flex flex-col">
          {!activeItem ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-muted-foreground/50">Idle</p>
            </div>
          ) : (
            <>
              {/* Top: Character + progress ring */}
              <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 gap-4">
                <div className="relative w-24 h-24 flex items-center justify-center">
                  {/* Background circle */}
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50" cy="50" r="42"
                      fill="none"
                      stroke="hsl(0 0% 15%)"
                      strokeWidth="4"
                    />
                    <circle
                      cx="50" cy="50" r="42"
                      fill="none"
                      stroke="hsl(0 0% 50%)"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 42}`}
                      strokeDashoffset={`${2 * Math.PI * 42 * (1 - progressPct / 100)}`}
                      className="transition-all duration-300"
                    />
                  </svg>
                  <span className="font-mono text-lg font-semibold text-foreground">
                    {progressPct.toFixed(0)}%
                  </span>
                </div>

                <div className="text-center">
                  <p className="font-display text-sm font-semibold tracking-wide">{activeItem.characterName}</p>
                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                    {progress?.prestigesDone ?? 0}/{progress?.totalTarget ?? 0} prestiges
                  </p>
                </div>
              </div>

              {/* Bottom: Stats bar */}
              <div className="border-t border-border grid grid-cols-3 divide-x divide-border">
                {[
                  { label: 'Prestige', value: progress ? `${progress.prestigesDone}/${progress.totalTarget}` : '-' },
                  { label: 'Level', value: progress ? (progress.bloodWebLevel === 51 ? 'MAX' : `${progress.bloodWebLevel}/50`) : '-' },
                  { label: 'P Level', value: progress ? `P${progress.prestigeLevel}` : '-' },
                ].map((stat) => (
                  <div key={stat.label} className="py-3 text-center">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-display">{stat.label}</div>
                    <div className="text-sm font-semibold font-mono mt-0.5">{stat.value}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
