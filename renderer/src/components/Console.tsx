import { useEffect, useRef, useState } from "react"
import { ChevronUp, X } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"

interface ConsoleProps {
  logs: Array<{
    id: string
    time: string
    message: string
    type: "info" | "success" | "error" | "warn" | "snipe"
  }>
  onClear: () => void
}

const typeColorMap: Record<ConsoleProps["logs"][number]["type"], string> = {
  info: "text-muted-foreground",
  success: "text-zinc-400",
  error: "text-zinc-500",
  warn: "text-zinc-500",
  snipe: "text-zinc-300",
}

export default function Console({ logs, onClear }: ConsoleProps) {
  const [collapsed, setCollapsed] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  return (
    <div
      className="flex flex-col overflow-hidden transition-[height] duration-200 ease-in-out"
      style={{ height: collapsed ? 32 : 160 }}
    >
      {/* Header */}
      <div
        className="flex h-8 min-h-[32px] shrink-0 cursor-pointer items-center justify-between border-t border-border bg-card px-3"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="select-none font-display text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          OUTPUT
        </span>

        <div className="flex items-center gap-1">
          <button
            className="flex h-[22px] w-[22px] items-center justify-center rounded-sm border-0 bg-transparent text-muted-foreground hover:bg-secondary"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
            aria-label="Clear console"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <button
            className="flex h-[22px] w-[22px] items-center justify-center rounded-sm border-0 bg-transparent text-muted-foreground hover:bg-secondary"
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed((c) => !c)
            }}
            aria-label="Toggle console"
          >
            <ChevronUp
              className="h-3.5 w-3.5 transition-transform duration-200"
              style={{ transform: collapsed ? "rotate(180deg)" : "rotate(0deg)" }}
            />
          </button>
        </div>
      </div>

      {/* Log body */}
      <ScrollArea className="flex-1 bg-background">
        <div className="px-3 py-2 font-mono text-xs">
          {logs.map((log) => (
            <div
              key={log.id}
              className="console-line flex flex-row items-baseline gap-3 py-px"
            >
              <span className="shrink-0 text-muted-foreground">{log.time}</span>
              <span className={typeColorMap[log.type]}>{log.message}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  )
}
