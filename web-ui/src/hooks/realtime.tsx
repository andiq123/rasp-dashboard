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
import type { ActivitySnapshot, AppState } from '@/api/types'

type RealtimeValue = {
  live: boolean
}

const RealtimeContext = createContext<RealtimeValue>({ live: false })

/** Shared EventSource for state, activity, and registry changes. */
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

function invalidateServiceCaches(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['services'] })
  void qc.invalidateQueries({ queryKey: ['service'] })
  void qc.invalidateQueries({ queryKey: ['groups'] })
  void qc.invalidateQueries({ queryKey: ['deployments'] })
}
