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
  const prevActivity = useRef<{ active: boolean; scope: string; deploymentId: string }>({
    active: false,
    scope: '',
    deploymentId: '',
  })

  useEffect(() => {
    let es: EventSource | null = null
    let disposed = false
    let lastStateAt = 0
    const watchdog = window.setInterval(() => {
      if (document.hidden) return
      if (lastStateAt > 0 && Date.now() - lastStateAt > 7000) setLive(false)
    }, 2000)

    const connect = () => {
      if (disposed || document.hidden || es) return
      try {
        const source = new EventSource('/api/events')
        es = source

        const onState = (ev: Event) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as AppState
            qc.setQueryData(queryKeys.state, data)
            lastStateAt = Date.now()
            setLive(true)
          } catch {
            /* ignore bad payloads */
          }
        }

        source.addEventListener('state', onState)
        source.onmessage = onState

        source.addEventListener('activity', (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as ActivitySnapshot
            qc.setQueryData(queryKeys.activity, data)
            setLive(true)
            const prev = prevActivity.current
            const scope = data.scope || ''
            const deploymentId = data.deployment_id || ''
            const phaseChanged =
              data.active !== prev.active ||
              scope !== prev.scope ||
              deploymentId !== prev.deploymentId
            prevActivity.current = { active: data.active, scope, deploymentId }
            if (phaseChanged) invalidateServiceCaches(qc)
          } catch {
            /* ignore */
          }
        })

        source.addEventListener('services', () => {
          setLive(true)
          invalidateServiceCaches(qc)
        })

        source.addEventListener('stats', (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as StatsSnapshot
            applyStatsSnapshot(qc, data)
            setLive(true)
          } catch {
            /* ignore */
          }
        })

        // EventSource reconnects automatically. Only a fresh state payload marks
        // the UI live; the watchdog enables HTTP fallback if the stream stalls.
        source.onopen = () => setLive(false)
        source.onerror = () => setLive(false)
      } catch {
        setLive(false)
      }
    }

    const onVisibility = () => {
      if (document.hidden) {
        // A background tab needs no live metrics. Keep fallback queries paused
        // and release the SSE subscription so the Pi enters its idle cadence.
        es?.close()
        es = null
        lastStateAt = 0
        setLive(true)
        return
      }
      setLive(false)
      connect()
    }

    document.addEventListener('visibilitychange', onVisibility)
    connect()
    return () => {
      disposed = true
      window.clearInterval(watchdog)
      document.removeEventListener('visibilitychange', onVisibility)
      es?.close()
    }
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
