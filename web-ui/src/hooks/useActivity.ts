import { useQuery } from '@tanstack/react-query'
import { fetchActivity } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { ActivitySnapshot } from '@/api/types'
import { useRealtime } from '@/hooks/realtime'

const empty: ActivitySnapshot = { seq: 0, active: false, lines: [] }

/** Live deploy/ops activity (SSE via RealtimeProvider, poll fallback). */
export function useActivity() {
  const { live } = useRealtime()

  const q = useQuery({
    queryKey: queryKeys.activity,
    queryFn: fetchActivity,
    initialData: empty,
    refetchInterval: live ? false : 3000,
  })

  return { activity: q.data ?? empty, live }
}

export function activityMatchesService(
  activity: ActivitySnapshot,
  group: string,
  slug: string,
): boolean {
  const scope = (activity.scope || '').trim()
  if (!scope) return false
  return scope === `${group}/${slug}` || scope.startsWith(`${group}/${slug}/`)
}

export function activityMatchesGroup(activity: ActivitySnapshot, group: string): boolean {
  const scope = (activity.scope || '').trim()
  if (!scope || !group) return false
  return scope === group || scope.startsWith(`${group}/`)
}
