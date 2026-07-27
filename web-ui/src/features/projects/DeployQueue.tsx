import { Link } from 'react-router-dom'
import { ListOrdered, Loader2 } from 'lucide-react'
import type { ActivitySnapshot, QueueItem } from '@/api/types'
import { muted, surface } from '@/lib/ui'
import { phaseLabel } from './serviceStatus'

type Props = {
  activity: ActivitySnapshot
  /** Highlight queue rows for this group (optional). */
  group?: string
}

function reasonLabel(reason?: string): string {
  switch (reason) {
    case 'webhook':
      return 'push'
    case 'auto':
      return 'auto'
    case 'redeploy':
      return 'redeploy'
    default:
      return 'deploy'
  }
}

export function DeployQueue({ activity, group }: Props) {
  const queue = activity.queue || []
  const phase = phaseLabel(activity.progress?.phase)
  const showActive = activity.active
  if (!showActive && !queue.length) return null

  return (
    <section
      className={`queue-enter ${surface} border border-base-300 px-3 py-2.5 grid gap-2`}
      aria-label="Deploy queue"
    >
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <ListOrdered className="h-4 w-4 text-warning shrink-0" aria-hidden />
          <strong className="text-xs">Deploy pipeline</strong>
          <span className={`text-[11px] ${muted}`}>one at a time</span>
        </div>
        {showActive ? (
          <span className="badge badge-info badge-sm gap-1" role="status">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            {phase || activity.progress?.label || activity.title || 'Running'}
          </span>
        ) : (
          <span className={`text-[11px] ${muted}`}>Waiting for next</span>
        )}
      </div>

      {showActive && activity.scope ? (
        <p className={`text-[11px] m-0 font-mono truncate ${muted}`}>
          Active · {activity.scope}
          {activity.progress?.detail ? ` · ${activity.progress.detail}` : ''}
        </p>
      ) : null}

      {queue.length ? (
        <ol className="list-none m-0 p-0 grid gap-1">
          {queue.map((item, i) => (
            <QueueRow key={item.id} item={item} index={i} dim={!!group && item.group !== group} />
          ))}
        </ol>
      ) : showActive ? (
        <p className={`text-[11px] m-0 ${muted}`}>Queue empty — next redeploy runs after this finishes.</p>
      ) : null}
    </section>
  )
}

function QueueRow({ item, index, dim }: { item: QueueItem; index: number; dim?: boolean }) {
  const to = `/projects/${encodeURIComponent(item.group)}/${encodeURIComponent(item.slug)}`
  return (
    <li
      className={[
        'queue-row flex items-center gap-2 px-2 py-1.5 rounded-box bg-base-200/50 border border-transparent',
        dim ? 'opacity-50' : '',
      ].join(' ')}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <span className="badge badge-warning badge-sm font-mono tabular-nums">#{item.position}</span>
      <Link to={to} className="min-w-0 flex-1 truncate text-xs font-semibold link link-hover">
        {item.name || item.slug}
      </Link>
      <span className={`text-[10px] uppercase tracking-wide shrink-0 ${muted}`}>{reasonLabel(item.reason)}</span>
    </li>
  )
}
