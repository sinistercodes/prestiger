import { useEffect, useState, useCallback, useRef } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import Titlebar from './components/Titlebar'
import Console from './components/Console'
import PrestigeTab from './components/PrestigeTab'
import QueueTab from './components/QueueTab'
import ProxyTab from './components/ProxyTab'
import SettingsTab from './components/SettingsTab'
import SniperTab from './components/SniperTab'
import UnlockTab from './components/UnlockTab'
import DebugTab from './components/DebugTab'
import TomesTab from './components/TomesTab'
import SummaryDialog from './components/SummaryDialog'
import BootLoader from './components/BootLoader'
import { useAppStore, type QueueItem } from './hooks/use-app-store'

export default function App() {
  const store = useAppStore()
  const [booted, setBooted] = useState(false)
  const [proxyActive, setProxyActive] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryData, setSummaryData] = useState<Record<string, number>>({})
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null)
  const [detectedExe, setDetectedExe] = useState<string | null>(null)
  const [debugLogs, setDebugLogs] = useState<ProxyRequestLog[]>([])

  // Listen for proxy request logs (persists across tab switches)
  useEffect(() => {
    const off = window.api.onRequestLog((entry) => {
      setDebugLogs(prev => {
        const next = [...prev, entry]
        return next.length > 500 ? next.slice(-500) : next
      })
    })
    return off
  }, [])

  const queueRef = useRef(store.queue)
  queueRef.current = store.queue
  const queueRunningRef = useRef(store.queueRunning)
  queueRunningRef.current = store.queueRunning
  const bhvrSessionRef = useRef(store.bhvrSession)
  bhvrSessionRef.current = store.bhvrSession
  const platformRef = useRef(store.platform)
  platformRef.current = store.platform

  // Load data on mount
  useEffect(() => {
    async function loadData() {
      try {
        const chars = await window.api.getCharacters()
        store.setCharacters(chars)
        store.log('Game data loaded', 'success')
        const savedConfig = await window.api.getUnlockConfig()
        if (savedConfig) {
          store.setUnlockConfig(savedConfig)
        }
      } catch (err: any) {
        store.log('Error loading data: ' + err.message, 'error')
      }
    }
    loadData()
  }, [])

  // Poll platform detection every 3 seconds
  useEffect(() => {
    let lastPlatform: string | null = null

    const poll = async () => {
      try {
        const result = await window.api.detectPlatform()
        setDetectedPlatform(result.platform)
        setDetectedExe(result.exe)

        if (result.detected && result.platform) {
          store.setPlatform(result.platform)
          // Only log on change
          if (lastPlatform !== result.platform) {
            const names: Record<string, string> = { steam: 'Steam', egs: 'Epic Games', ms_store: 'MS Store' }
            store.log(`Attached to ${names[result.platform]}`, 'success')
            lastPlatform = result.platform
          }
        } else {
          if (lastPlatform !== null) {
            store.log('Game process exited — detached', 'warn')
            lastPlatform = null
          }
        }
      } catch {}
    }

    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [])

  // Poll proxy status
  useEffect(() => {
    const check = async () => {
      try {
        const s = await window.api.getProxyStatus()
        setProxyActive(s.running && s.certInstalled)
      } catch {}
    }
    check()
    const id = setInterval(check, 5000)
    return () => clearInterval(id)
  }, [])

  // IPC: Prestige events
  useEffect(() => {
    const offEvent = window.api.onPrestigeEvent((data) => {
      const q = queueRef.current
      const active = q.find(i => i.status === 'active')

      switch (data.type) {
        case 'log': {
          const msg = data.message ?? ''
          let type: 'info' | 'success' | 'error' | 'warn' | 'snipe' = 'info'
          if (msg.includes('Error') || msg.includes('Warning')) type = 'error'
          else if (msg.includes('Prestige Up!')) type = 'success'
          else if (msg.includes('Sniped:')) type = 'snipe'
          store.log(msg, type)
          break
        }
        case 'bloodpoints':
          store.setBloodpoints(data.value ?? null)
          break
        case 'progress':
          if (active) {
            store.updateQueueItem(active.id, {
              progress: {
                prestigesDone: data.prestigesDone!,
                totalTarget: data.totalTarget!,
                bloodWebLevel: data.bloodWebLevel!,
                prestigeLevel: data.prestigeLevel!,
              },
            })
          }
          break
        case 'summary':
          if (active && data.snipedItems) {
            store.updateQueueItem(active.id, { result: { prestigesDone: 0, totalTarget: 0, snipedItems: data.snipedItems } })
          }
          break
      }
    })

    const offComplete = window.api.onPrestigeComplete((result) => {
      const q = queueRef.current
      const active = q.find(i => i.status === 'active')

      if (active) {
        store.updateQueueItem(active.id, {
          status: result.error ? 'error' : 'done',
          result,
          error: result.error,
        })
      }

      store.setIsPrestiging(false)

      if (queueRunningRef.current) {
        setTimeout(() => processNext(), 100)
      } else {
        if (result.snipedItems && Object.keys(result.snipedItems).length > 0) {
          setSummaryData(result.snipedItems)
          setSummaryOpen(true)
        }
      }
    })

    let lastCapturedCookie = ''
    const offCookie = window.api.onCookieCaptured(({ platform, cookie }) => {
      if (cookie === lastCapturedCookie) return
      lastCapturedCookie = cookie
      store.setBhvrSession(cookie)
      store.setPlatform(platform)
      store.log(`Session captured via proxy (${platform})`, 'success')
    })

    const offFarmEvent = window.api.onFarmEvent((data) => {
      switch (data.type) {
        case 'log': {
          const msg = data.message ?? ''
          let type: 'info' | 'success' | 'error' | 'warn' | 'snipe' = 'info'
          if (msg.includes('Error') || msg.includes('error')) type = 'error'
          else if (msg.includes('Sniped:')) type = 'snipe'
          store.log(msg, type)
          break
        }
        case 'snipedItem':
          if (data.name) {
            store.setFarmStats(prev => ({
              ...prev,
              snipedCount: prev.snipedCount + 1,
              snipedItems: {
                ...prev.snipedItems,
                [data.name!]: data.total ?? 0,
              },
            }))
          }
          break
        case 'stats':
          store.setFarmStats(prev => ({
            ...prev,
            bloodpointsSpent: data.bloodpointsSpent ?? prev.bloodpointsSpent,
          }))
          break
      }
    })

    const offFarmComplete = window.api.onFarmComplete((result) => {
      store.setIsFarming(false)
      if (result.error) {
        store.log(`Farm error: ${result.error}`, 'error')
      } else {
        store.log(`Farming complete. ${result.bloodwebsProcessed} bloodwebs processed.`, 'success')
      }
    })

    return () => {
      offEvent()
      offComplete()
      offCookie()
      offFarmEvent()
      offFarmComplete()
    }
  }, [])

  const processNext = useCallback(() => {
    const next = queueRef.current.find(q => q.status === 'pending')
    if (!next) {
      store.setQueueRunning(false)
      store.setIsPrestiging(false)

      const allSniped: Record<string, number> = {}
      queueRef.current.filter(q => q.result?.snipedItems).forEach(q => {
        Object.entries(q.result!.snipedItems).forEach(([name, count]) => {
          allSniped[name] = (allSniped[name] || 0) + (count as number)
        })
      })
      if (Object.keys(allSniped).length > 0) {
        setSummaryData(allSniped)
        setSummaryOpen(true)
      }
      store.log('Queue complete', 'success')
      return
    }

    store.updateQueueItem(next.id, { status: 'active' })
    store.setIsPrestiging(true)

    window.api.startPrestige({
      bhvrSession: bhvrSessionRef.current.trim(),
      characterId: next.characterId,
      prestigeCount: next.prestigeCount,
      platform: platformRef.current,
      sniperConfig: next.sniperConfig,
    })
  }, [])

  // ── Actions ──
  const handleAddToQueue = () => {
    const allChars = [...store.characters.survivors, ...store.characters.killers]
    store.selectedCharacters.forEach(charId => {
      const char = allChars.find(c => c.id === charId)
      if (char) {
        const type = store.characters.survivors.some(s => s.id === charId) ? 'Survivor' : 'Killer'
        store.addToQueue(charId, char.name, type as 'Survivor' | 'Killer')
      }
    })
  }

  const handleStartDirect = () => {
    if (store.isPrestiging) return
    const allChars = [...store.characters.survivors, ...store.characters.killers]

    store.selectedCharacters.forEach(charId => {
      const char = allChars.find(c => c.id === charId)
      if (char) {
        const type = store.characters.survivors.some(s => s.id === charId) ? 'Survivor' : 'Killer'
        store.addToQueue(charId, char.name, type as 'Survivor' | 'Killer')
      }
    })

    store.setQueueRunning(true)
    setTimeout(() => processNext(), 50)
  }

  const handleStartQueue = () => {
    if (store.queueRunning) return
    store.setQueueRunning(true)
    processNext()
  }

  const handleCancelAll = () => {
    window.api.cancelPrestige()
    store.setQueue(prev => prev.map(q => {
      if (q.status === 'active') return { ...q, status: 'cancelled' as const }
      if (q.status === 'pending') return { ...q, status: 'cancelled' as const }
      return q
    }))
    store.setQueueRunning(false)
    store.setIsPrestiging(false)
    store.log('Queue cancelled', 'warn')
  }

  const handleStartFarm = (config: { characterId: string; sniperConfig: string[]; mode: string }) => {
    if (store.isFarming || store.isPrestiging) return
    store.resetFarmStats()
    store.setIsFarming(true)
    window.api.startFarm({
      bhvrSession: store.bhvrSession.trim(),
      characterId: config.characterId,
      sniperConfig: config.sniperConfig,
      mode: config.mode,
      platform: store.platform,
    })
  }

  const handleStopFarm = () => {
    window.api.cancelFarm()
  }

  const handleAutoDetect = async () => {
    try {
      const data = await window.api.getCookie()
      if (data.cookies && data.cookies.length > 0) {
        const match = data.cookies.find((c: any) => c.platform === store.platform) || data.cookies[0]
        store.setBhvrSession(match.value)
        if (match.platform) store.setPlatform(match.platform)
        store.log(`Cookie found via ${data.source}`, 'success')
      } else {
        store.log('No cookies found', 'warn')
      }
    } catch (err: any) {
      store.log('Cookie detection error: ' + err.message, 'error')
    }
  }

  const activeItem = store.queue.find(q => q.status === 'active')

  return (
    <div className="h-screen flex flex-col">
      {!booted && <BootLoader onComplete={() => setBooted(true)} />}
      <Titlebar platform={detectedPlatform} platformExe={detectedExe} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Tabs defaultValue="prestige" className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Bar */}
          <div className="bg-card border-b border-border px-2 flex items-center h-10 shrink-0">
            <TabsList className="bg-transparent h-full gap-0 p-0">
              {['prestige', 'queue', 'sniper', 'unlock', 'tomes', 'proxy', 'debug', 'about'].map(tab => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent text-muted-foreground h-full px-4 text-xs font-display uppercase tracking-[0.1em] font-semibold"
                >
                  {tab}
                  {tab === 'queue' && store.queue.filter(q => q.status === 'pending').length > 0 && (
                    <Badge variant="secondary" className="ml-1.5 h-4 text-[9px] px-1.5">
                      {store.queue.filter(q => q.status === 'pending').length}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="ml-auto flex items-center gap-3 pr-2">
              {store.bloodpoints !== null && (
                <Badge variant="outline" className="text-[10px] h-5 font-mono border-zinc-600/30 text-zinc-400 bg-zinc-700/10">
                  {store.bloodpoints.toLocaleString()} BP
                </Badge>
              )}
              <div
                className={cn(
                  'w-2 h-2 rounded-full transition-all',
                  proxyActive ? 'bg-zinc-400' : 'bg-muted-foreground'
                )}
                title={proxyActive ? 'Proxy active' : 'Proxy inactive'}
              />
            </div>
          </div>

          {/* Tab Panels */}
          <TabsContent value="prestige" className="flex-1 mt-0 overflow-hidden">
            <PrestigeTab
              survivors={store.characters.survivors}
              killers={store.characters.killers}
              selectedCharacters={store.selectedCharacters}
              onSelectedCharactersChange={store.setSelectedCharacters}
              bhvrSession={store.bhvrSession}
              onBhvrSessionChange={store.setBhvrSession}
              prestigeCount={store.prestigeCount}
              onPrestigeCountChange={store.setPrestigeCount}
              onAddToQueue={handleAddToQueue}
              onStartDirect={handleStartDirect}
              onAutoDetect={handleAutoDetect}
              onCancel={() => window.api.cancelPrestige()}
              isPrestiging={store.isPrestiging}
              activeItem={activeItem}
            />
          </TabsContent>

          <TabsContent value="queue" className="flex-1 mt-0 overflow-hidden">
            <QueueTab
              queue={store.queue}
              queueRunning={store.queueRunning}
              onStartQueue={handleStartQueue}
              onCancelAll={handleCancelAll}
              onRemoveItem={store.removeFromQueue}
            />
          </TabsContent>

          <TabsContent value="sniper" className="flex-1 mt-0 overflow-hidden">
            <SniperTab
              survivors={store.characters.survivors}
              killers={store.characters.killers}
              bhvrSession={store.bhvrSession}
              onBhvrSessionChange={store.setBhvrSession}
              platform={store.platform}
              isFarming={store.isFarming}
              isPrestiging={store.isPrestiging}
              farmStats={store.farmStats}
              onStartFarm={handleStartFarm}
              onStopFarm={handleStopFarm}
              onAutoDetect={handleAutoDetect}
            />
          </TabsContent>

          <TabsContent value="unlock" className="flex-1 mt-0 overflow-hidden">
            <UnlockTab
              config={store.unlockConfig}
              onConfigChange={store.setUnlockConfig}
              proxyActive={proxyActive}
            />
          </TabsContent>

          <TabsContent value="tomes" className="flex-1 mt-0 overflow-hidden">
            <TomesTab proxyActive={proxyActive} />
          </TabsContent>

          <TabsContent value="proxy" className="flex-1 mt-0 overflow-hidden">
            <ProxyTab
              onLog={store.log}
              onSessionSelect={(value, platform) => {
                store.setBhvrSession(value)
                store.setPlatform(platform)
                store.log(`Using ${platform} session from proxy`, 'success')
              }}
            />
          </TabsContent>

          <TabsContent value="debug" className="flex-1 mt-0 overflow-hidden">
            <DebugTab logs={debugLogs} onClearLogs={() => setDebugLogs([])} />
          </TabsContent>

          <TabsContent value="about" className="flex-1 mt-0 overflow-hidden">
            <SettingsTab />
          </TabsContent>
        </Tabs>

        {/* Console */}
        <Console logs={store.logs} onClear={store.clearLogs} />
      </div>

      {/* Modals */}
      <SummaryDialog
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        snipedItems={summaryData}
      />
    </div>
  )
}
