import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Coins, Pencil, Plus, Waypoints } from 'lucide-react'
import { fetchResidential } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { ResidentialSession } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { Panel } from '@/components/ui/Panel/Panel'
import { PanelSkeleton } from '@/components/ui/Skeleton/Skeleton'
import { ResidentialBalanceDialog } from '@/features/overview/ResidentialBalance'
import { fmtDuration } from '@/lib/devices'
import { fmtGB, fmtRelative } from '@/lib/format'

const RECENT = 5

/** Tone for what is left: plenty, getting low, nearly out. */
const leftTone = (bytes: number) => (bytes < 200e6 ? 'bad' : bytes < 1e9 ? 'warn' : 'ok')

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Residential proxy data: what is left, this month, and recent sessions. */
export function ResidentialPanel() {
  const q = useQuery({ queryKey: queryKeys.residential, queryFn: fetchResidential, refetchInterval: (query) => (query.state.data?.active ? 15_000 : 60_000) })
  const [editing, setEditing] = useState(false)
  const u = q.data
  const left = u?.remaining_bytes
  const sessions: (ResidentialSession & { live?: boolean })[] = [
    ...(u?.active && u.session_start ? [{ start: u.session_start, end: new Date(q.dataUpdatedAt).toISOString(), bytes: u.session_bytes, live: true }] : []),
    ...(u?.sessions || []),
  ]
  const thisMonth = sessions.filter((sess) => sess.start.startsWith(u?.month || '-')).length
  const biggest = Math.max(1, ...sessions.slice(0, RECENT).map((sess) => sess.bytes))
  const usedSince = u?.balance_bytes != null && left != null ? u.balance_bytes - left : 0

  return (
    <Panel
      title={<span className="inline-flex items-center gap-1.5"><Waypoints aria-hidden /> Residential data</span>}
      actions={u?.balance_set_at ? <Button variant="infoSoft" icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} onClick={() => setEditing(true)}>Update balance</Button> : undefined}
      busy={q.isFetching}
    >

        {q.isLoading ? (
          <PanelSkeleton rows={3} label="Loading residential data" />
        ) : (
          <>
            <div className="item-row">
              <span className={`icon-chip tone-${left != null ? leftTone(left) : 'idle'}`}><Coins aria-hidden /></span>
              <span className="item-text">
                <strong className={left != null && leftTone(left) !== 'ok' ? `text-${leftTone(left) === 'bad' ? 'error' : 'warning'}` : undefined}>
                  {left != null ? `${fmtGB(left)} left` : 'Balance not set'}
                </strong>
                <span className="meta">
                  {u?.balance_set_at ? (
                    <>
                      <span>Entered {fmtRelative(u.balance_set_at)}</span>
                      <span>{fmtGB(usedSince)} used since</span>
                    </>
                  ) : (
                    <span>Enter what IPRoyal shows; the Pi counts down from it</span>
                  )}
                </span>
              </span>
              {!u?.balance_set_at ? <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => setEditing(true)}>Set balance</Button> : null}
            </div>

            {u?.balance_bytes ? (
              <div className={`res-meter tone-${leftTone(left ?? 0)}`} role="meter" aria-label="Residential data used since the balance was entered" aria-valuemin={0} aria-valuemax={u.balance_bytes} aria-valuenow={usedSince}>
                <span style={{ width: `${Math.min(100, (usedSince / u.balance_bytes) * 100)}%` }} />
              </div>
            ) : null}

            <div className="res-stats">
              <div><small>This month</small><strong>{fmtGB(u?.month_bytes)}</strong></div>
              <div><small>Sessions this month</small><strong>{thisMonth}</strong></div>
            </div>

            {sessions.length ? (
              <ul className="res-sessions" aria-label="Recent sessions">
                {sessions.slice(0, RECENT).map((sess) => (
                  <li key={sess.start} className={sess.live ? 'is-live' : undefined}>
                    <span className="res-when">{sess.live ? 'Now' : when(sess.start)}</span>
                    <span className="res-dur">{fmtDuration((Date.parse(sess.end) - Date.parse(sess.start)) / 1000)}</span>
                    <span className="res-bar" aria-hidden><span style={{ width: `${(sess.bytes / biggest) * 100}%` }} /></span>
                    <strong>{fmtGB(sess.bytes)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pop-line">No residential sessions yet.</p>
            )}
            {sessions.length > RECENT ? <p className="pop-line">{sessions.length - RECENT} earlier sessions kept on the Pi.</p> : null}
          </>
        )}
      <ResidentialBalanceDialog
        open={editing}
        usage={u}
        onClose={() => setEditing(false)}
        onDone={() => {
          setEditing(false)
          void q.refetch()
        }}
      />
    </Panel>
  )
}
