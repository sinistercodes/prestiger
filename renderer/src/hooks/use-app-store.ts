import { useState, useCallback, useRef } from 'react'

const MAX_LOGS = 500

export interface LogEntry {
  id: string
  time: string
  message: string
  type: 'info' | 'success' | 'error' | 'warn' | 'snipe'
}

export interface QueueItem {
  id: string
  characterId: string
  characterName: string
  characterType: 'Survivor' | 'Killer'
  prestigeCount: number
  sniperConfig: string[]
  status: 'pending' | 'active' | 'done' | 'error' | 'cancelled'
  progress?: { prestigesDone: number; totalTarget: number; bloodWebLevel: number; prestigeLevel: number }
  result?: PrestigeResult
  error?: string
}

export interface FarmStats {
  snipedCount: number
  snipedItems: Record<string, number>
  bloodwebsProcessed: number
  bloodpointsSpent: number
}

export interface UnlockConfig {
  enabled: boolean
  characters: {
    enabled: boolean
    prestigeLevel: number | 'random'
    prestigeRandomMin?: number
    prestigeRandomMax?: number
    bloodwebLevel: number | 'random'
    bloodwebRandomMin?: number
    bloodwebRandomMax?: number
  }
  cosmetics: { enabled: boolean }
  currency: {
    enabled: boolean
    bloodpoints: number
    shards: number
    cells: number
  }
  level: { enabled: boolean; value: number }
  itemQuantity: number
  killswitch: { enabled: boolean }
  tutorials: { enabled: boolean }
  blockGamelogs: { enabled: boolean }
}

export function useAppStore() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [isPrestiging, setIsPrestiging] = useState(false)
  const [queueRunning, setQueueRunning] = useState(false)
  const [bloodpoints, setBloodpoints] = useState<number | null>(null)
  const [characters, setCharacters] = useState<{ survivors: Character[]; killers: Character[] }>({ survivors: [], killers: [] })

  const [isFarming, setIsFarming] = useState(false)
  const [farmStats, setFarmStats] = useState<FarmStats>({ snipedCount: 0, snipedItems: {}, bloodwebsProcessed: 0, bloodpointsSpent: 0 })
  const [unlockConfig, setUnlockConfig] = useState<UnlockConfig>({
    enabled: false,
    characters: { enabled: false, prestigeLevel: 100, bloodwebLevel: 50 },
    cosmetics: { enabled: false },
    currency: { enabled: false, bloodpoints: 999999999, shards: 999999999, cells: 999999999 },
    level: { enabled: false, value: 99 },
    itemQuantity: 100,
    killswitch: { enabled: false },
    tutorials: { enabled: false },
    blockGamelogs: { enabled: false },
  })

  // Form state
  const [bhvrSession, setBhvrSession] = useState('')
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([])
  const [prestigeCount, setPrestigeCount] = useState(1)
  const [platform, setPlatform] = useState('egs')

  const log = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      time: new Date().toLocaleTimeString('en-US', { hour12: false }),
      message,
      type,
    }
    setLogs(prev => {
      const next = [...prev, entry]
      return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next
    })
  }, [])

  const clearLogs = useCallback(() => setLogs([]), [])

  const addToQueue = useCallback((charId: string, charName: string, charType: 'Survivor' | 'Killer') => {
    const item: QueueItem = {
      id: crypto.randomUUID(),
      characterId: charId,
      characterName: charName,
      characterType: charType,
      prestigeCount,
      sniperConfig: [],
      status: 'pending',
    }
    setQueue(prev => [...prev, item])
    log(`Added ${charName} (x${prestigeCount}) to queue`)
  }, [prestigeCount, log])

  const removeFromQueue = useCallback((id: string) => {
    setQueue(prev => prev.filter(q => q.id !== id))
  }, [])

  const updateQueueItem = useCallback((id: string, updates: Partial<QueueItem>) => {
    setQueue(prev => prev.map(q => q.id === id ? { ...q, ...updates } : q))
  }, [])

  const resetFarmStats = useCallback(() => {
    setFarmStats({ snipedCount: 0, snipedItems: {}, bloodwebsProcessed: 0, bloodpointsSpent: 0 })
  }, [])

  return {
    logs, log, clearLogs,
    queue, setQueue, addToQueue, removeFromQueue, updateQueueItem,
    isPrestiging, setIsPrestiging,
    queueRunning, setQueueRunning,
    bloodpoints, setBloodpoints,
    characters, setCharacters,
    bhvrSession, setBhvrSession,
    selectedCharacters, setSelectedCharacters,
    prestigeCount, setPrestigeCount,
    platform, setPlatform,
    isFarming, setIsFarming,
    farmStats, setFarmStats, resetFarmStats,
    unlockConfig, setUnlockConfig,
  }
}
