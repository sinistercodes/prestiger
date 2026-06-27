import { useState, useRef, useEffect, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  Trash2, ArrowDown, Eye, X, Copy, Check,
  Download, Plus, Send, Edit3, RefreshCw, Loader2
} from 'lucide-react'

interface DebugTabProps {
  logs: ProxyRequestLog[]
  onClearLogs: () => void
  onAppendLog: (log: ProxyRequestLog) => void
}

type DetailTab = 'request' | 'response' | 'headers'
type SourceFilter = 'all' | 'proxy' | 'engine' | 'replay'

// ── helpers ──────────────────────────────────────────────────────────────────

function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const k = line.slice(0, idx).trim()
    const v = line.slice(idx + 1).trim()
    if (k) out[k] = v
  }
  return out
}

function stringifyHeaderLines(headers: Record<string, string> | null | undefined): string {
  if (!headers) return ''
  return Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n')
}

function tryFormatJson(s: string | null | undefined): string {
  if (!s) return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

function formatSize(bytes: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

function getEndpoint(path: string) {
  const parts = path.split('?')[0].split('/')
  const meaningful = parts.filter(p => p && p !== 'api' && p !== 'v1')
  return meaningful.slice(-2).join('/') || path
}

function getStatusColor(status: number) {
  if (status >= 200 && status < 300) return 'text-green-500'
  if (status >= 300 && status < 400) return 'text-yellow-500'
  if (status >= 400) return 'text-red-400'
  return 'text-muted-foreground'
}

function sourceLabel(source: ProxyRequestLog['source']): string {
  if (source === 'engine') return 'ENGINE'
  if (source === 'replay') return 'REPLAY'
  return 'PROXY'
}

function sourceClass(source: ProxyRequestLog['source']): string {
  if (source === 'engine') return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
  if (source === 'replay') return 'bg-violet-500/15 text-violet-400 border-violet-500/30'
  return 'bg-secondary/50 text-muted-foreground border-border'
}

function buildReplayUrl(log: ProxyRequestLog): string {
  if (!log) return ''
  const path = log.path || ''
  if (/^https?:\/\//i.test(path)) return path
  const host = log.host || ''
  if (!host) return path
  return `https://${host}${path.startsWith('/') ? path : '/' + path}`
}

// ── Request Editor dialog ───────────────────────────────────────────────────

interface RequestEditorProps {
  open: boolean
  onClose: () => void
  initial: {
    method: string
    url: string
    headers: Record<string, string>
    body: string
  } | null
  onAppendLog: (log: ProxyRequestLog) => void
}

function RequestEditor({ open, onClose, initial, onAppendLog }: RequestEditorProps) {
  const [method, setMethod] = useState('POST')
  const [url, setUrl] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [sending, setSending] = useState(false)
  const [response, setResponse] = useState<ReplayResponse | null>(null)
  const [copied, setCopied] = useState(false)

  // Reset fields whenever the dialog opens (or its `initial` changes).
  useEffect(() => {
    if (!open) return
    if (initial) {
      setMethod(initial.method || 'POST')
      setUrl(initial.url || '')
      setHeadersText(stringifyHeaderLines(initial.headers))
      setBodyText(initial.body || '')
    } else {
      setMethod('POST')
      setUrl('')
      setHeadersText('')
      setBodyText('')
    }
    setResponse(null)
    setCopied(false)
  }, [open, initial])

  const handleSend = async () => {
    if (!url.trim() || sending) return
    setSending(true)
    setResponse(null)
    try {
      const headers = parseHeaderLines(headersText)
      const result = await window.api.replayRequest({
        method,
        url: url.trim(),
        headers,
        body: bodyText.length > 0 ? bodyText : undefined,
      })
      setResponse(result)

      // Push synthetic log entry so the user can also pick it from the list.
      let host = ''
      let pathOnly = url
      try {
        const u = new URL(url)
        host = u.host
        pathOnly = u.pathname + (u.search || '')
      } catch { /* leave defaults */ }

      onAppendLog({
        timestamp: Date.now(),
        source: 'replay',
        method,
        host,
        path: pathOnly,
        status: result.status,
        size: result.body ? new TextEncoder().encode(result.body).length : 0,
        intercepted: null,
        snooped: null,
        requestBody: bodyText.length > 0 ? bodyText : null,
        responseBody: result.body || null,
        requestHeaders: headers,
        responseHeaders: result.headers,
        durationMs: result.durationMs,
      })
    } catch (err: any) {
      setResponse({
        ok: false,
        status: 0,
        headers: {},
        body: '',
        durationMs: 0,
        error: err?.message || 'Request failed',
      })
    } finally {
      setSending(false)
    }
  }

  const copyBody = () => {
    if (!response?.body) return
    navigator.clipboard.writeText(tryFormatJson(response.body))
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Request Editor
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto pr-1">
          {/* Method + URL + Send */}
          <div className="flex gap-2">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="h-7 w-[92px] bg-secondary/50 border-border text-[11px] font-mono rounded-sm px-2 shrink-0 shadow-none ring-offset-0 outline-none focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none data-[state=open]:bg-secondary/70">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border text-[11px] font-mono min-w-[92px]">
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(m => (
                  <SelectItem key={m} value={m} className="text-[11px] font-mono py-1.5 cursor-pointer">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://steam.live.bhvrdbd.com/api/v1/..."
              spellCheck={false}
              className="flex-1 h-7 bg-secondary/50 border border-border rounded-sm px-2 text-[11px] font-mono outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={handleSend}
              disabled={sending || !url.trim()}
              className="h-7 px-3 bg-foreground text-background rounded-sm text-[10px] font-display font-semibold uppercase tracking-[0.1em] hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-2.5 w-2.5" />}
              {sending ? 'Sending' : 'Send'}
            </button>
          </div>

          {/* Headers */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-display">
              Headers (one per line, "Key: Value")
            </label>
            <textarea
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder={'api-key: …\nContent-Type: application/json'}
              spellCheck={false}
              rows={5}
              className="bg-secondary/50 border border-border rounded-sm px-2 py-1.5 text-[10px] font-mono outline-none focus:ring-1 focus:ring-ring resize-y"
            />
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-display">
              Body
            </label>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder={'{"characterName": "K01", ...}'}
              spellCheck={false}
              rows={8}
              className="bg-secondary/50 border border-border rounded-sm px-2 py-1.5 text-[10px] font-mono outline-none focus:ring-1 focus:ring-ring resize-y"
            />
          </div>

          {/* Response */}
          {response && (
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={cn(
                  "text-[9px] font-mono h-4",
                  getStatusColor(response.status),
                  "border-border"
                )}>
                  {response.status || '—'} {response.statusText || ''}
                </Badge>
                <Badge variant="outline" className="text-[9px] font-mono h-4 border-border">
                  {response.durationMs}ms
                </Badge>
                {response.error && (
                  <span className="text-[10px] text-red-400 font-mono">{response.error}</span>
                )}
                <button
                  onClick={copyBody}
                  disabled={!response.body}
                  className="ml-auto text-[9px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 disabled:opacity-30"
                >
                  {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                  {copied ? 'Copied' : 'Copy body'}
                </button>
              </div>
              {Object.keys(response.headers || {}).length > 0 && (
                <details className="mt-1">
                  <summary className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-display cursor-pointer">
                    Response headers
                  </summary>
                  <pre className="mt-1 bg-secondary/30 border border-border rounded-sm p-2 text-[10px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                    {stringifyHeaderLines(response.headers)}
                  </pre>
                </details>
              )}
              <pre className="mt-1 bg-secondary/30 border border-border rounded-sm p-2 text-[10px] font-mono whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                {tryFormatJson(response.body) || '(empty)'}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── DebugTab ────────────────────────────────────────────────────────────────

export default function DebugTab({ logs, onClearLogs, onAppendLog }: DebugTabProps) {
  const [filter, setFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [selected, setSelected] = useState<ProxyRequestLog | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('response')
  const [copied, setCopied] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorInitial, setEditorInitial] = useState<RequestEditorProps['initial']>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevLogCount = useRef(logs.length)

  useEffect(() => {
    if (autoScroll && logs.length > prevLogCount.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevLogCount.current = logs.length
  }, [logs.length, autoScroll])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 30
    setAutoScroll(atBottom)
  }, [])

  const lowerFilter = filter.toLowerCase()
  const filtered = logs.filter(l => {
    if (sourceFilter !== 'all' && (l.source || 'proxy') !== sourceFilter) return false
    if (!lowerFilter) return true
    return l.path.toLowerCase().includes(lowerFilter)
      || l.host.toLowerCase().includes(lowerFilter)
      || String(l.status).includes(lowerFilter)
  })

  const handleCopy = (text: string | null | undefined) => {
    if (!text) return
    navigator.clipboard.writeText(tryFormatJson(text))
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      setAutoScroll(true)
    }
  }

  const handleExport = async () => {
    if (logs.length === 0) {
      setExportStatus('Nothing to export')
      setTimeout(() => setExportStatus(null), 2000)
      return
    }
    setExportStatus('Saving…')
    try {
      const res = await window.api.exportDebugLogs(logs)
      if (res.success) {
        setExportStatus(`Saved ${res.count} entries`)
      } else if (res.cancelled) {
        setExportStatus(null)
      } else {
        setExportStatus(`Failed: ${res.error || 'unknown'}`)
      }
    } catch (err: any) {
      setExportStatus(`Failed: ${err?.message || 'error'}`)
    }
    setTimeout(() => setExportStatus(null), 2500)
  }

  const openEditorForSelected = () => {
    if (!selected) return
    setEditorInitial({
      method: selected.method,
      url: buildReplayUrl(selected),
      headers: selected.requestHeaders || {},
      body: selected.requestBody || '',
    })
    setEditorOpen(true)
  }

  const openEditorBlank = () => {
    setEditorInitial(null)
    setEditorOpen(true)
  }

  // Resend selected as-is, push response to the log list, select it.
  const handleResend = async () => {
    if (!selected || resending) return
    setResending(true)
    try {
      const url = buildReplayUrl(selected)
      const headers = selected.requestHeaders || {}
      const result = await window.api.replayRequest({
        method: selected.method,
        url,
        headers,
        body: selected.requestBody || undefined,
      })

      const newEntry: ProxyRequestLog = {
        timestamp: Date.now(),
        source: 'replay',
        method: selected.method,
        host: selected.host,
        path: selected.path,
        status: result.status,
        size: result.body ? new TextEncoder().encode(result.body).length : 0,
        intercepted: null,
        snooped: null,
        requestBody: selected.requestBody,
        responseBody: result.body || null,
        requestHeaders: headers,
        responseHeaders: result.headers,
        durationMs: result.durationMs,
      }
      onAppendLog(newEntry)
      setSelected(newEntry)
      setDetailTab('response')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-4 h-full p-4">
      {/* ── Left: Request List ──────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => { onClearLogs(); setSelected(null) }}
              className="h-6 w-6 rounded-sm flex items-center justify-center bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
              title="Clear all logs"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={scrollToBottom}
              className={cn(
                "h-6 w-6 rounded-sm flex items-center justify-center transition-colors",
                autoScroll ? "bg-foreground/10 text-foreground" : "bg-secondary/50 text-muted-foreground hover:text-foreground"
              )}
              title={autoScroll ? 'Auto-scroll on' : 'Scroll to bottom'}
            >
              <ArrowDown className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={openEditorBlank}
              className="h-6 px-2 rounded-sm flex items-center gap-1 bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors text-[9px] font-display uppercase tracking-[0.1em]"
              title="Compose new request"
            >
              <Plus className="h-2.5 w-2.5" /> New
            </button>
            <button
              onClick={handleExport}
              className="h-6 px-2 rounded-sm flex items-center gap-1 bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors text-[9px] font-display uppercase tracking-[0.1em]"
              title="Export all logs to JSON"
            >
              <Download className="h-2.5 w-2.5" /> Export
            </button>
          </div>

          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="flex-1 h-6 bg-secondary/50 border border-border rounded-sm px-2 text-[10px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
          />

          <Badge variant="outline" className="text-[8px] h-4 font-mono border-border text-muted-foreground shrink-0">
            {filtered.length}/{logs.length}
          </Badge>
        </div>

        {/* Source filter row */}
        <div className="px-3 py-1 border-b border-border/50 flex items-center gap-1 shrink-0">
          {(['all', 'proxy', 'engine', 'replay'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={cn(
                "h-4 px-1.5 rounded-sm text-[8px] font-display uppercase tracking-[0.1em] transition-colors",
                sourceFilter === s
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground/70"
              )}
            >
              {s}
            </button>
          ))}
          {!autoScroll && (
            <Badge variant="secondary" className="text-[8px] h-4 ml-auto shrink-0">SCROLL PAUSED</Badge>
          )}
          {exportStatus && (
            <span className="ml-auto text-[9px] text-muted-foreground font-mono">{exportStatus}</span>
          )}
        </div>

        {/* List */}
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
                  <Badge variant="outline" className={cn(
                    "text-[7px] h-3 px-1 font-mono shrink-0",
                    sourceClass(log.source)
                  )}>
                    {sourceLabel(log.source)}
                  </Badge>
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

      {/* ── Right: Detail ───────────────────────────────────────────────── */}
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
                <p className="text-[10px] text-muted-foreground/40 mt-1">
                  Or use <span className="text-foreground/60">+ New</span> to compose one
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Detail header */}
            <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
              <span className={cn(
                "font-mono font-semibold text-[10px] shrink-0",
                selected.method === 'POST' ? 'text-yellow-500/80' : 'text-blue-400/80'
              )}>
                {selected.method}
              </span>
              <Badge variant="outline" className={cn(
                "text-[8px] h-4 px-1 font-mono shrink-0",
                sourceClass(selected.source)
              )}>
                {sourceLabel(selected.source)}
              </Badge>
              <span className="font-mono text-[10px] text-foreground/80 truncate flex-1" title={`${selected.host}${selected.path}`}>
                {selected.host}{selected.path}
              </span>
              <span className={cn("font-mono text-[10px] tabular-nums shrink-0", getStatusColor(selected.status))}>
                {selected.status}
              </span>
              {selected.durationMs != null && (
                <span className="font-mono text-[9px] text-muted-foreground tabular-nums shrink-0">
                  {selected.durationMs}ms
                </span>
              )}
              <button
                onClick={() => setSelected(null)}
                className="h-5 w-5 rounded-sm flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Close"
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {/* Action row */}
            <div className="px-3 py-1.5 border-b border-border/50 flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleResend}
                disabled={resending}
                className="h-6 px-2 rounded-sm flex items-center gap-1 bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors text-[9px] font-display uppercase tracking-[0.1em] disabled:opacity-40"
                title="Resend exactly as captured"
              >
                {resending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                Resend
              </button>
              <button
                onClick={openEditorForSelected}
                className="h-6 px-2 rounded-sm flex items-center gap-1 bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors text-[9px] font-display uppercase tracking-[0.1em]"
                title="Edit then send"
              >
                <Edit3 className="h-2.5 w-2.5" /> Edit & Send
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border shrink-0">
              {(['request', 'response', 'headers'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={cn(
                    "flex-1 py-1.5 text-[10px] font-display font-semibold uppercase tracking-[0.1em] transition-colors relative",
                    detailTab === tab ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
                  )}
                >
                  {tab === 'request' ? 'Request Body' : tab === 'response' ? 'Response Body' : 'Headers'}
                  {detailTab === tab && (
                    <span className="absolute bottom-0 left-4 right-4 h-px bg-foreground/50" />
                  )}
                </button>
              ))}
            </div>

            {/* Copy row */}
            <div className="px-3 py-1.5 border-b border-border/50 flex items-center justify-between shrink-0">
              <span className="text-[9px] text-muted-foreground font-mono">
                {detailTab === 'request' && (selected.requestBody ? `${selected.requestBody.length.toLocaleString()} chars` : 'empty')}
                {detailTab === 'response' && (selected.responseBody ? `${selected.responseBody.length.toLocaleString()} chars` : 'empty')}
                {detailTab === 'headers' && (
                  `${Object.keys(selected.requestHeaders || {}).length} req · ${Object.keys(selected.responseHeaders || {}).length} res`
                )}
              </span>
              <button
                onClick={() => {
                  if (detailTab === 'request') handleCopy(selected.requestBody)
                  else if (detailTab === 'response') handleCopy(selected.responseBody)
                  else {
                    const txt = `# Request\n${stringifyHeaderLines(selected.requestHeaders)}\n\n# Response\n${stringifyHeaderLines(selected.responseHeaders)}`
                    navigator.clipboard.writeText(txt)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1200)
                  }
                }}
                className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            {/* Body / Headers */}
            <div className="flex-1 overflow-auto p-3">
              {detailTab === 'headers' ? (
                <div className="flex flex-col gap-3">
                  <div>
                    <h3 className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-display mb-1">
                      Request headers
                    </h3>
                    <pre className="text-[10px] font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed bg-secondary/30 rounded-sm p-2">
                      {stringifyHeaderLines(selected.requestHeaders) || '(none)'}
                    </pre>
                  </div>
                  <div>
                    <h3 className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-display mb-1">
                      Response headers
                    </h3>
                    <pre className="text-[10px] font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed bg-secondary/30 rounded-sm p-2">
                      {stringifyHeaderLines(selected.responseHeaders) || '(none)'}
                    </pre>
                  </div>
                </div>
              ) : (
                <pre className="text-[10px] font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed">
                  {tryFormatJson(detailTab === 'request' ? selected.requestBody : selected.responseBody) || '(empty)'}
                </pre>
              )}
            </div>
          </>
        )}
      </div>

      <RequestEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        initial={editorInitial}
        onAppendLog={onAppendLog}
      />
    </div>
  )
}
