import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Search, X } from 'lucide-react'

interface ItemSniperModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: string[]
  onSelectedChange: (ids: string[]) => void
  characterType?: 'Survivor' | 'Killer' | null
}

const RARITY_COLORS: Record<string, string> = {
  'EItemRarity::Common': 'bg-zinc-600',
  'EItemRarity::Uncommon': 'bg-yellow-700',
  'EItemRarity::Rare': 'bg-green-700',
  'EItemRarity::VeryRare': 'bg-purple-700',
  'EItemRarity::UltraRare': 'bg-red-700',
  'EItemRarity::Artifact': 'bg-pink-700',
}

type FilterTab = 'items' | 'addons' | 'offerings'

export default function ItemSniperModal({
  open,
  onOpenChange,
  selected,
  onSelectedChange,
  characterType,
}: ItemSniperModalProps) {
  const [items, setItems] = useState<GameItem[]>([])
  const [addons, setAddons] = useState<GameItem[]>([])
  const [offerings, setOfferings] = useState<GameItem[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterTab>('items')
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) {
      setLocalSelected(new Set(selected))
      setSearch('')
      Promise.all([
        window.api.getItems(),
        window.api.getAddons(),
        window.api.getOfferings(),
      ]).then(([i, a, o]) => {
        setItems(i)
        setAddons(a)
        setOfferings(o)
      })
    }
  }, [open, selected])

  const filteredItems = useMemo(() => {
    let source: GameItem[] = []
    if (filter === 'items') source = items
    else if (filter === 'addons') source = addons
    else source = offerings

    // Filter by character type
    if (characterType) {
      const role = characterType === 'Survivor' ? 'EPlayerRole::VE_Camper' : 'EPlayerRole::VE_Slasher'
      source = source.filter(item =>
        item.CharacterType === role || item.CharacterType === 'EPlayerRole::VE_None'
      )
      // Survivors don't use killer items, killers don't have items tab
      if (characterType === 'Killer' && filter === 'items') source = []
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      source = source.filter(item => item.Name.toLowerCase().includes(q))
    }

    return source
  }, [filter, items, addons, offerings, search, characterType])

  const toggle = (id: string) => {
    const next = new Set(localSelected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setLocalSelected(next)
  }

  const handleConfirm = () => {
    onSelectedChange(Array.from(localSelected))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-sm uppercase tracking-wider">
            Item Sniper
            {localSelected.size > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">{localSelected.size} selected</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="flex gap-2 items-center">
          <div className="flex gap-1">
            {(['items', 'addons', 'offerings'] as FilterTab[]).map(tab => (
              <Button
                key={tab}
                variant={filter === tab ? 'default' : 'outline'}
                size="sm"
                className="text-[10px] h-7 px-3 uppercase"
                onClick={() => setFilter(tab)}
              >
                {tab}
              </Button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-7 pl-7 text-xs bg-secondary/50"
            />
          </div>
        </div>

        {/* Item Grid */}
        <div className="flex-1 overflow-y-auto min-h-0 grid grid-cols-3 gap-1.5 p-1">
          {filteredItems.map(item => {
            const isSelected = localSelected.has(item.ItemId)
            const rarityColor = RARITY_COLORS[item.Rarity ?? ''] || 'bg-zinc-700'
            return (
              <button
                key={item.ItemId}
                onClick={() => toggle(item.ItemId)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-sm text-left transition-colors text-[11px] ${
                  isSelected
                    ? 'bg-primary/20 border border-primary/50'
                    : 'bg-secondary/30 border border-transparent hover:bg-secondary/60'
                }`}
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${rarityColor}`} />
                <span className="truncate">{item.Name}</span>
              </button>
            )
          })}
          {filteredItems.length === 0 && (
            <div className="col-span-3 flex items-center justify-center py-8 text-xs text-muted-foreground">
              {filter === 'items' && characterType === 'Killer' ? 'Killers do not have items' : 'No items found'}
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between">
          {localSelected.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-[10px] h-7 gap-1"
              onClick={() => setLocalSelected(new Set())}
            >
              <X className="h-3 w-3" /> Clear All
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" className="text-xs h-8" onClick={handleConfirm}>
              Confirm ({localSelected.size})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
