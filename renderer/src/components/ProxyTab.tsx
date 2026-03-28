import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Shield, ShieldCheck, ShieldX, Download, Trash2, Power, PowerOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProxyTabProps {
  onLog: (msg: string, type: 'info' | 'success' | 'error' | 'warn') => void
  onSessionSelect: (value: string, platform: string) => void
}

export default function ProxyTab({ onLog, onSessionSelect }: ProxyTabProps) {
  const [status, setStatus] = useState<ProxyStatus | null>(null)
  const [toggling, setToggling] = useState(false)
  const [certAction, setCertAction] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const s = await window.api.getProxyStatus()
      setStatus(s)
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const handleToggle = async () => {
    setToggling(true)
    try {
      if (status?.running) {
        await window.api.proxyStop()
        onLog('Proxy stopped', 'warn')
      } else {
        await window.api.proxyStart()
        onLog('Proxy started', 'success')
      }
      await fetchStatus()
    } catch (err: any) {
      onLog('Proxy error: ' + err.message, 'error')
    }
    setToggling(false)
  }

  const running = status?.running ?? false
  const certInstalled = status?.certInstalled ?? false
  const cookies = status?.capturedCookies ?? []

  const handleCertAction = async () => {
    setCertAction(true)
    try {
      // Re-check current status to avoid stale state
      const currentStatus = await window.api.getProxyStatus()
      const isInstalled = currentStatus.certInstalled

      if (isInstalled) {
        const result = await window.api.proxyRemoveCert()
        if (result.success) {
          onLog('CA certificate removed', 'success')
        } else {
          onLog('Cert removal failed: ' + (result.error || 'Unknown'), 'error')
        }
      } else {
        const result = await window.api.proxyInstallCert()
        if (result.success) {
          onLog('CA certificate installed', 'success')
        } else {
          onLog('Cert install failed: ' + (result.error || 'Unknown'), 'error')
        }
      }
      await fetchStatus()
    } catch (err: any) {
      onLog('Cert error: ' + err.message, 'error')
    }
    setCertAction(false)
  }

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-4 h-full p-4">
      {/* Left: Proxy Control */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border">
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            MITM Proxy
          </h2>
        </div>
        <div className="flex-1 p-4 space-y-4">
          {/* Status indicator */}
          <div className="flex items-center gap-3 p-3 rounded-sm bg-secondary/50">
            {running && certInstalled ? (
              <ShieldCheck className="h-5 w-5 text-foreground" />
            ) : running ? (
              <Shield className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ShieldX className="h-5 w-5 text-muted-foreground" />
            )}
            <div>
              <div className="text-sm font-medium">
                {running && certInstalled && 'Proxy Active'}
                {running && !certInstalled && 'Cert Not Installed'}
                {!running && 'Proxy Inactive'}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {running && certInstalled && 'Intercepting game traffic'}
                {running && !certInstalled && 'Install CA cert to intercept HTTPS'}
                {!running && 'Enable to auto-capture session cookies'}
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            The proxy intercepts Dead by Daylight network traffic to automatically capture your session cookie.
            Enable it before launching the game.
          </p>

          <Separator className="bg-border/50" />

          <div className="space-y-2">
            <Button
              variant="outline"
              className={cn(
                'w-full h-9 text-xs gap-2',
                certInstalled && 'text-muted-foreground'
              )}
              onClick={handleCertAction}
              disabled={certAction}
            >
              {certInstalled ? (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  {certAction ? 'Removing...' : 'Remove CA Certificate'}
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  {certAction ? 'Installing...' : 'Install CA Certificate'}
                </>
              )}
            </Button>
            <Button
              className={cn(
                'w-full h-9 text-xs gap-2',
                running ? 'bg-secondary hover:bg-secondary/80 text-foreground' : 'bg-primary hover:bg-primary/90'
              )}
              onClick={handleToggle}
              disabled={toggling || !certInstalled}
            >
              {running ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
              {toggling ? 'Working...' : running ? 'Disable Proxy' : 'Enable Proxy'}
            </Button>
          </div>
        </div>
      </div>

      {/* Right: Captured Sessions */}
      <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Captured Sessions
          </h2>
          {cookies.length > 0 && (
            <button
              onClick={async () => {
                await window.api.clearCapturedSessions()
                onLog('Sessions cleared', 'info')
                await fetchStatus()
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex-1 p-4">
          {cookies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-muted-foreground">No sessions captured</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">Enable proxy and launch the game</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {cookies.map((c: CapturedCookie, i: number) => (
                <button
                  key={i}
                  onClick={() => onSessionSelect(c.value, c.platform)}
                  className="w-full flex items-center justify-between p-3 rounded-sm bg-secondary/50 hover:bg-secondary/80 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] h-5 uppercase font-display tracking-wider">
                      {c.platform}
                    </Badge>
                    <span className="text-xs font-mono text-muted-foreground truncate max-w-[200px]">
                      {c.value.slice(0, 24)}...
                    </span>
                  </div>
                  {c.capturedAt && (
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(c.capturedAt).toLocaleTimeString()}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
