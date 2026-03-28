import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Play, Trash2, X } from 'lucide-react'
import type { QueueItem } from '@/hooks/use-app-store'
import { cn } from '@/lib/utils'

interface QueueTabProps {
  queue: QueueItem[]
  queueRunning: boolean
  onStartQueue: () => void
  onCancelAll: () => void
  onRemoveItem: (id: string) => void
}

const statusConfig: Record<QueueItem['status'], { label: string; className: string }> = {
  pending: { label: 'PENDING', className: 'bg-secondary text-muted-foreground' },
  active: { label: 'ACTIVE', className: 'bg-zinc-700/20 text-zinc-300 border-zinc-500/30' },
  done: { label: 'DONE', className: 'bg-zinc-700/15 text-zinc-400 border-zinc-600/30' },
  error: { label: 'ERROR', className: 'bg-zinc-700/15 text-zinc-500 border-zinc-600/30' },
  cancelled: { label: 'CANCELLED', className: 'bg-secondary text-muted-foreground' },
}

export default function QueueTab({
  queue,
  queueRunning,
  onStartQueue,
  onCancelAll,
  onRemoveItem,
}: QueueTabProps) {
  const hasPending = queue.some(q => q.status === 'pending')

  return (
    <div className="h-full p-4">
      <div className="bg-card border border-border rounded-sm flex flex-col h-full overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Character Queue
            {queue.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px] h-4">{queue.length}</Badge>
            )}
          </h2>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-7 text-[11px] gap-1 bg-primary hover:bg-primary/90"
              disabled={!hasPending || queueRunning}
              onClick={onStartQueue}
            >
              <Play className="h-3 w-3" />
              Start Queue
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-[11px] gap-1"
              disabled={!queueRunning}
              onClick={onCancelAll}
            >
              <X className="h-3 w-3" />
              Cancel All
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-sm text-muted-foreground">Queue is empty</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">Add characters from the Prestige tab</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {queue.map((item) => {
                const status = statusConfig[item.status]
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-sm border-l-2 transition-colors',
                      item.status === 'active' && 'bg-zinc-700/10 border-l-zinc-400',
                      item.status === 'done' && 'bg-zinc-700/5 border-l-zinc-500 opacity-60',
                      item.status === 'error' && 'bg-zinc-700/5 border-l-zinc-600',
                      item.status === 'cancelled' && 'border-l-muted-foreground/30 opacity-40',
                      item.status === 'pending' && 'border-l-border hover:bg-secondary/30',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.characterName}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                        P x{item.prestigeCount}
                        {item.progress && ` | ${item.progress.prestigesDone}/${item.progress.totalTarget}`}
                        {item.sniperConfig.length > 0 && ` | ${item.sniperConfig.length} snipe target${item.sniperConfig.length > 1 ? 's' : ''}`}
                      </div>
                    </div>
                    <Badge variant="outline" className={cn('text-[9px] h-5 px-2 uppercase tracking-wider font-display', status.className)}>
                      {status.label}
                    </Badge>
                    {item.status === 'pending' && (
                      <button
                        onClick={() => onRemoveItem(item.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
