import { useState, useRef, useEffect, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Trash2, ArrowDown, Eye, X, Copy, Check } from 'lucide-react'

interface DebugTabProps {
  logs: ProxyRequestLog[]
  onClearLogs: () => void
}

export default function DebugTab({ logs, onClearLogs }: DebugTabProps) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<ProxyRequestLog | null>(null)
  const [detailTab, setDetailTab] = useState<'request' | 'response'>('response')
  const [copied, setCopied] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevLogCount = useRef(logs.length)

  // Auto-scroll only when new logs arrive AND autoScroll is on
  useEffect(() => {
    if (autoScroll && logs.length > prevLogCount.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevLogCount.current = logs.length
  }, [logs.length, autoScroll])

  // Detect if user scrolls up — disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 30
    setAutoScroll(atBottom)
  }, [])

  const lowerFilter = filter.toLowerCase()
  const filtered = lowerFilter
    ? logs.filter(l => l.path.toLowerCase().includes(lowerFilter) || l.host.toLowerCase().includes(lowerFilter))
    : logs

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'text-green-500'
    if (status >= 300 && status < 400) return 'text-yellow-500'
    if (status >= 400) return 'text-red-400'
    return 'text-muted-foreground'
  }

  const formatSize = (bytes: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`
  }

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const getEndpoint = (path: string) => {
    const parts = path.split('/')
    const meaningful = parts.filter(p => p && p !== 'api' && p !== 'v1')
    return meaningful.slice(-2).join('/')
  }

  const formatJson = (str: string | null) => {
    if (!str) return '(empty)'
    try {
      return JSON.stringify(JSON.parse(str), null, 2)
    } catch {
      return str
    }
  }

  const handleCopy = (text: string | null) => {
    if (!text) return
    navigator.clipboard.writeText(formatJson(text))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      setAutoScroll(true)
    }
  }

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-4 h-full p-4">
      {/* Left: Request List */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => { onClearLogs(); setSelected(null) }}
              className="h-6 w-6 rounded-sm flex items-center justify-center bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
              title="Clear"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={scrollToBottom}
              className={cn(
                "h-6 w-6 rounded-sm flex items-center justify-center transition-colors",
                autoScroll ? "bg-foreground/10 text-foreground" : "bg-secondary/50 text-muted-foreground hover:text-foreground"
              )}
              title={autoScroll ? 'Auto-scroll ON' : 'Scroll to bottom'}
            >
              <ArrowDown className="h-2.5 w-2.5" />
            </button>
          </div>

          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            className="flex-1 h-6 bg-secondary/50 border border-border rounded-sm px-2 text-[10px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
          />

          <Badge variant="outline" className="text-[8px] h-4 font-mono border-border text-muted-foreground shrink-0">
            {filtered.length}
          </Badge>
          {!autoScroll && (
            <Badge variant="secondary" className="text-[8px] h-4 shrink-0">SCROLL PAUSED</Badge>
          )}
        </div>

        {/* Request list */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-muted-foreground/50">
                {logs.length === 0 ? 'No requests yet' : 'No matches'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {filtered.map((log, i) => (
                <div
                  key={`${log.timestamp}-${i}`}
                  className={cn(
                    "flex items-center gap-2 px-2.5 py-1.5 text-[10px] font-mono cursor-pointer transition-colors",
                    selected === log ? "bg-foreground/[0.08]" : "hover:bg-secondary/30",
                    log.intercepted && "border-l-2 border-l-foreground/20"
                  )}
                  onClick={() => { setSelected(log); setDetailTab('response') }}
                >
                  <span className="text-muted-foreground tabular-nums shrink-0 w-[52px]">{formatTime(log.timestamp)}</span>
                  <span className={cn(
                    "font-semibold shrink-0 w-[32px]",
                    log.method === 'POST' ? 'text-yellow-500/80' : 'text-blue-400/80'
                  )}>
                    {log.method}
                  </span>
                  <span className="truncate flex-1 text-foreground/80" title={`${log.host}${log.path}`}>
                    {getEndpoint(log.path)}
                  </span>
                  <span className={cn("tabular-nums shrink-0 w-[26px] text-right", getStatusColor(log.status))}>
                    {log.status || '—'}
                  </span>
                  <span className="text-muted-foreground tabular-nums shrink-0 w-[36px] text-right text-[9px]">
                    {formatSize(log.size)}
                  </span>
                  {log.intercepted && (
                    <Badge variant="secondary" className="text-[7px] h-3 px-1 font-mono bg-foreground/10 shrink-0">
                      SPOOF
                    </Badge>
                  )}
                  {log.snooped && (
                    <Badge variant="outline" className="text-[7px] h-3 px-1 font-mono border-border shrink-0">
                      SNOOP
                    </Badge>
                  )}
                  <Eye className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Request/Response Detail */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        {!selected ? (
          <>
            <div className="px-4 py-2.5 border-b border-border">
              <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                Request Detail
              </h2>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Eye className="h-6 w-6 mx-auto text-muted-foreground/20 mb-2" />
                <p className="text-xs text-muted-foreground/50">Click a request to inspect</p>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Detail header */}
            <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
              <span className={cn(
                "font-mono font-semibold text-[10px]",
                selected.method === 'POST' ? 'text-yellow-500/80' : 'text-blue-400/80'
              )}>
                {selected.method}
              </span>
              <span className="font-mono text-[10px] text-foreground/80 truncate flex-1" title={`${selected.host}${selected.path}`}>
                {selected.host}{selected.path}
              </span>
              <span className={cn("font-mono text-[10px] tabular-nums shrink-0", getStatusColor(selected.status))}>
                {selected.status}
              </span>
              <button
                onClick={() => setSelected(null)}
                className="h-5 w-5 rounded-sm flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border shrink-0">
              {(['request', 'response'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={cn(
                    "flex-1 py-1.5 text-[10px] font-display font-semibold uppercase tracking-[0.1em] transition-colors relative",
                    detailTab === tab ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
                  )}
                >
                  {tab === 'request' ? 'Request Body' : 'Response Body'}
                  {detailTab === tab && (
                    <span className="absolute bottom-0 left-4 right-4 h-px bg-foreground/50" />
                  )}
                </button>
              ))}
            </div>

            {/* Copy */}
            <div className="px-3 py-1.5 border-b border-border/50 flex items-center justify-between shrink-0">
              <span className="text-[9px] text-muted-foreground font-mono">
                {detailTab === 'request'
                  ? (selected.requestBody ? `${selected.requestBody.length.toLocaleString()} chars` : 'empty')
                  : (selected.responseBody ? `${selected.responseBody.length.toLocaleString()} chars` : 'empty')
                }
              </span>
              <button
                onClick={() => handleCopy(detailTab === 'request' ? selected.requestBody : selected.responseBody)}
                className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto p-3">
              <pre className="text-[10px] font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed">
                {formatJson(detailTab === 'request' ? selected.requestBody : selected.responseBody)}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
