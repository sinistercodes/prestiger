import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

interface SummaryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  snipedItems: Record<string, number>
}

export default function SummaryDialog({ open, onOpenChange, snipedItems }: SummaryDialogProps) {
  const sorted = Object.entries(snipedItems).sort((a, b) => b[1] - a[1])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-base uppercase tracking-wider">Prestige Complete</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[50vh]">
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No items sniped.</p>
          ) : (
            <div className="space-y-1">
              {sorted.map(([name, count]) => (
                <div key={name} className="flex items-center justify-between px-3 py-2 rounded-sm bg-secondary/50">
                  <span className="text-sm">{name}</span>
                  <span className="text-sm font-mono font-semibold text-primary">x{count}</span>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <DialogFooter>
          <Button size="sm" className="bg-primary hover:bg-primary/90 text-xs" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
