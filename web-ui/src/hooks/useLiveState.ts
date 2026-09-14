import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchState, readInitialState } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { useRealtime } from '@/hooks/realtime'

export function useLiveState() {
  const { live } = useRealtime()
  const [initial] = useState(readInitialState)

  const q = useQuery({
    queryKey: queryKeys.state,
    queryFn: fetchState,
    initialData: initial,
    refetchInterval: live ? false : 4000,
  })

  return { state: q.data ?? initial, live, isLoading: q.isLoading, isError: q.isError }
}
