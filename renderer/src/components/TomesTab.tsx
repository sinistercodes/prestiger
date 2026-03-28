import { useState, useEffect } from 'react'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { BookOpen, Zap, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TomeEvent {
  type: string
  nodeId?: string
  storyId?: string
  progress?: string
  total?: number
  message?: string
}

interface TomesTabProps {
  proxyActive: boolean
}

export default function TomesTab({ proxyActive }: TomesTabProps) {
  const [enabled, setEnabled] = useState(false)
  const [events, setEvents] = useState<TomeEvent[]>([])
  const [status, setStatus] = useState<{ completedCount: number; hasHeaders: boolean; lastMatch: string | null }>({
    completedCount: 0,
    hasHeaders: false,
    lastMatch: null,
  })

  useEffect(() => {
    window.api.getTomesConfig().then((config: { enabled: boolean }) => {
      setEnabled(config.enabled)
    })
    window.api.getTomesStatus().then(setStatus)
  }, [])

  useEffect(() => {
    const unsub = window.api.onTomeEvent((event: TomeEvent) => {
      setEvents(prev => [...prev.slice(-49), event])
      if (event.type === 'completed') {
        setStatus(s => ({ ...s, completedCount: event.total || s.completedCount + 1 }))
      }
      window.api.getTomesStatus().then(setStatus)
    })
    return unsub
  }, [])

  // Poll status periodically when enabled
  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(() => {
      window.api.getTomesStatus().then(setStatus)
    }, 10000)
    return () => clearInterval(interval)
  }, [enabled])

  const toggle = (value: boolean) => {
    setEnabled(value)
    window.api.setTomesConfig({ enabled: value })
  }

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-4 h-full p-4">
      {/* Left: Configuration */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border">
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Tome Configuration
          </h2>
        </div>
        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          {/* Master toggle */}
          <div className={cn(
            "flex items-center justify-between p-3 rounded-sm transition-colors",
            enabled ? "bg-foreground/[0.06]" : "bg-secondary/50"
          )}>
            <div className="flex items-center gap-3">
              <BookOpen className={cn("h-5 w-5", enabled ? "text-foreground" : "text-muted-foreground")} />
              <div>
                <div className="text-sm font-medium">
                  {enabled ? 'Auto-Complete Active' : 'Auto-Complete Off'}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {enabled
                    ? 'Quests will complete after each match'
                    : 'Enable to auto-complete tome challenges'
                  }
                </div>
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={toggle} />
          </div>

          {/* Status indicators */}
          <div className="space-y-2">
            <div className="flex items-center justify-between p-2.5 bg-secondary/30 rounded-sm">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  proxyActive ? "bg-green-500" : "bg-muted-foreground"
                )} />
                <span className="text-xs text-muted-foreground">Proxy</span>
              </div>
              <span className="text-xs font-mono">
                {proxyActive ? 'Connected' : 'Inactive'}
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 bg-secondary/30 rounded-sm">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  status.hasHeaders ? "bg-green-500" : "bg-muted-foreground"
                )} />
                <span className="text-xs text-muted-foreground">Game Session</span>
              </div>
              <span className="text-xs font-mono">
                {status.hasHeaders ? 'Captured' : 'Waiting'}
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 bg-secondary/30 rounded-sm">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Quests Completed</span>
              </div>
              <Badge variant="secondary" className="text-[10px] h-5 font-mono">
                {status.completedCount}
              </Badge>
            </div>
          </div>

          {/* Event log */}
          {events.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-display uppercase tracking-[0.15em] text-muted-foreground mb-2">
                Recent Activity
              </div>
              {events.slice().reverse().map((evt, i) => (
                <div key={i} className="flex items-start gap-2 p-2 bg-secondary/20 rounded-sm">
                  {evt.type === 'completed' ? (
                    <Zap className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  ) : evt.type === 'error' ? (
                    <AlertCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {evt.type === 'completed' && `Quest completed (${evt.progress})`}
                    {evt.type === 'error' && `Error: ${evt.message}`}
                    {evt.type === 'no-quest' && 'No active quest found'}
                    {evt.type === 'already-complete' && 'Quest already complete'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Explanation */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border">
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            How It Works
          </h2>
        </div>
        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold">1</span>
              </div>
              <div>
                <div className="text-sm font-medium">Play a match</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Queue into any match as survivor or killer. The proxy detects your role and captures match data automatically.
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold">2</span>
              </div>
              <div>
                <div className="text-sm font-medium">Match ends</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  When the match finishes and analytics are sent, the tool detects the match completion and extracts the match identifiers.
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold">3</span>
              </div>
              <div>
                <div className="text-sm font-medium">Quest auto-completes</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  The tool fetches your currently selected tome challenge, calculates the remaining progress needed, and submits the exact completion data using your real match ID.
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold">4</span>
              </div>
              <div>
                <div className="text-sm font-medium">Repeat</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Each match completes one quest step. Select your next challenge in the tome and play another match. Works for both survivor and killer challenges.
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-4 space-y-2">
            <div className="text-[10px] font-display uppercase tracking-[0.15em] text-muted-foreground">
              Requirements
            </div>
            <ul className="space-y-1.5">
              <li className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                <span className="text-[11px] text-muted-foreground">Proxy must be active and connected</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                <span className="text-[11px] text-muted-foreground">Select the challenge you want to complete in the tome menu before queuing</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                <span className="text-[11px] text-muted-foreground">You must complete a real match — the tool uses your actual match data</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                <span className="text-[11px] text-muted-foreground">One quest completes per match — play multiple matches for multi-step challenges</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
