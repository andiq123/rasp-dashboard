import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchState, readInitialState } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { AppState } from '@/api/types'

export function useLiveState() {
  const qc = useQueryClient()
  const initial = readInitialState()
  const [live, setLive] = useState(false)

  const q = useQuery({
    queryKey: queryKeys.state,
    queryFn: fetchState,
    initialData: initial,
    refetchInterval: live ? false : 4000,
  })

  useEffect(() => {
    let es: EventSource | null = null
    let closed = false
    try {
      es = new EventSource('/api/events')
      es.onopen = () => setLive(true)
      es.onerror = () => setLive(false)
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as AppState
          qc.setQueryData(queryKeys.state, data)
          setLive(true)
        } catch {
          /* ignore malformed */
        }
      }
    } catch {
      setLive(false)
    }
    return () => {
      closed = true
      es?.close()
      if (!closed) setLive(false)
    }
  }, [qc])

  return { state: q.data ?? initial, live, isLoading: q.isLoading }
}
