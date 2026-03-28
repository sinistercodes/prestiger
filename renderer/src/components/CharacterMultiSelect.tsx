import * as React from "react"
import { ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

interface CharacterMultiSelectProps {
  survivors: Array<{ name: string; id: string }>
  killers: Array<{ name: string; id: string }>
  selected: string[]
  onSelectionChange: (ids: string[]) => void
}

export default function CharacterMultiSelect({
  survivors,
  killers,
  selected,
  onSelectionChange,
}: CharacterMultiSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [tab, setTab] = React.useState<'survivors' | 'killers'>('survivors')

  const allCharacters = React.useMemo(
    () => [...survivors, ...killers],
    [survivors, killers]
  )

  function toggleSelection(id: string) {
    if (selected.includes(id)) {
      onSelectionChange(selected.filter((s) => s !== id))
    } else {
      onSelectionChange([...selected, id])
    }
  }

  function selectAllInGroup(group: Array<{ id: string }>) {
    const ids = group.map(c => c.id)
    const allSelected = ids.every(id => selected.includes(id))
    if (allSelected) {
      onSelectionChange(selected.filter(id => !ids.includes(id)))
    } else {
      const newIds = ids.filter(id => !selected.includes(id))
      onSelectionChange([...selected, ...newIds])
    }
  }

  const lowerSearch = search.toLowerCase()
  const activeGroup = tab === 'survivors' ? survivors : killers
  const filtered = activeGroup.filter(c => c.name.toLowerCase().includes(lowerSearch))
  const allSelected = activeGroup.length > 0 && activeGroup.every(c => selected.includes(c.id))

  const survivorSelectedCount = survivors.filter(c => selected.includes(c.id)).length
  const killerSelectedCount = killers.filter(c => selected.includes(c.id)).length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-9 bg-secondary/50 border-border text-sm hover:bg-secondary/80"
        >
          <span className="flex flex-1 items-center gap-1 overflow-hidden">
            {selected.length === 0 ? (
              <span className="text-muted-foreground text-xs">Select characters...</span>
            ) : (
              <span className="text-xs text-foreground">
                {selected.length} character{selected.length > 1 ? 's' : ''} selected
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        sideOffset={4}
      >
        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab('survivors')}
            className={cn(
              "flex-1 py-2 text-[11px] font-display font-semibold uppercase tracking-[0.1em] transition-colors relative",
              tab === 'survivors' ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
            )}
          >
            Survivors
            {survivorSelectedCount > 0 && (
              <span className="ml-1 text-[9px] text-muted-foreground">({survivorSelectedCount})</span>
            )}
            {tab === 'survivors' && (
              <span className="absolute bottom-0 left-4 right-4 h-px bg-foreground/50" />
            )}
          </button>
          <button
            onClick={() => setTab('killers')}
            className={cn(
              "flex-1 py-2 text-[11px] font-display font-semibold uppercase tracking-[0.1em] transition-colors relative",
              tab === 'killers' ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
            )}
          >
            Killers
            {killerSelectedCount > 0 && (
              <span className="ml-1 text-[9px] text-muted-foreground">({killerSelectedCount})</span>
            )}
            {tab === 'killers' && (
              <span className="absolute bottom-0 left-4 right-4 h-px bg-foreground/50" />
            )}
          </button>
        </div>

        {/* Search + Select All */}
        <div className="p-2 flex gap-2 items-center border-b border-border">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs bg-secondary/50 border-border flex-1"
          />
          <button
            onClick={() => selectAllInGroup(activeGroup)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap px-1"
          >
            {allSelected ? 'Clear' : 'All'}
          </button>
        </div>

        {/* Characters */}
        <ScrollArea className="h-[220px]">
          <div className="p-2">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No characters found.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {filtered.map((character) => {
                  const isSelected = selected.includes(character.id)
                  return (
                    <button
                      key={character.id}
                      onClick={() => toggleSelection(character.id)}
                      className={cn(
                        "px-2 py-1 rounded-sm text-[11px] border transition-colors",
                        isSelected
                          ? "bg-foreground/10 border-foreground/20 text-foreground"
                          : "bg-secondary/30 border-border/50 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      )}
                    >
                      {character.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
