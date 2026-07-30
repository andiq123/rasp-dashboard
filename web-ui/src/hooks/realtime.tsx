import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/queryKeys'
import type { ActivitySnapshot, AppState, RuntimeStats } from '@/api/types'

type RealtimeValue = {
  live: boolean
}

export type StatsSnapshot = {
  at?: string
  groups?: Record<string, Record<string, RuntimeStats>>
}

const RealtimeContext = createContext<RealtimeValue>({ live: false })

/** Shared EventSource for state, activity, registry, and live container stats. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [live, setLive] = useState(false)
  const prevActivity = useRef<{ active: boolean; scope: string }>({ active: false, scope: '' })

  useEffect(() => {
    let es: EventSource | null = null
    try {
      es = new EventSource('/api/events')

      const onState = (ev: Event) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as AppState
          qc.setQueryData(queryKeys.state, data)
          setLive(true)
        } catch {
          /* ignore bad payloads */
        }
      }

      es.addEventListener('state', onState)
      es.onmessage = onState

      es.addEventListener('activity', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as ActivitySnapshot
          qc.setQueryData(queryKeys.activity, data)
          setLive(true)
          const prev = prevActivity.current
          const scope = data.scope || ''
          const phaseChanged = data.active !== prev.active || scope !== prev.scope
          prevActivity.current = { active: data.active, scope }
          if (phaseChanged) invalidateServiceCaches(qc)
        } catch {
          /* ignore */
        }
      })

      es.addEventListener('services', () => {
        setLive(true)
        invalidateServiceCaches(qc)
      })

      es.addEventListener('stats', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as StatsSnapshot
          applyStatsSnapshot(qc, data)
          setLive(true)
        } catch {
          /* ignore */
        }
      })

      es.onopen = () => setLive(true)
      es.onerror = () => setLive(false)
    } catch {
      setLive(false)
    }
    return () => es?.close()
  }, [qc])

  return <RealtimeContext.Provider value={{ live }}>{children}</RealtimeContext.Provider>
}

export function useRealtime(): RealtimeValue {
  return useContext(RealtimeContext)
}

function applyStatsSnapshot(qc: QueryClient, snap: StatsSnapshot) {
  const groups = snap.groups || {}
  for (const [group, stats] of Object.entries(groups)) {
    qc.setQueryData(queryKeys.groupStats(group), stats)
  }
  // Patch open service detail caches so meters move without waiting for service refetch.
  for (const [group, stats] of Object.entries(groups)) {
    for (const [slug, st] of Object.entries(stats)) {
      qc.setQueryData(queryKeys.service(group, slug), (prev: unknown) => {
        if (!prev || typeof prev !== 'object') return prev
        return { ...(prev as object), stats: st }
      })
      qc.setQueryData(queryKeys.services(group), (prev: unknown) => {
        if (!Array.isArray(prev)) return prev
        return prev.map((s: { slug?: string; stats?: RuntimeStats }) =>
          s?.slug === slug ? { ...s, stats: st } : s,
        )
      })
    }
  }
}

function invalidateServiceCaches(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['services'] })
  void qc.invalidateQueries({ queryKey: ['service'] })
  void qc.invalidateQueries({ queryKey: ['groups'] })
  void qc.invalidateQueries({ queryKey: ['deployments'] })
}
