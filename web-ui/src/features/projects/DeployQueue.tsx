import { Link } from 'react-router-dom'
import { Clock } from 'lucide-react'
import type { ActivitySnapshot, QueueItem } from '@/api/types'
import { muted } from '@/lib/ui'

type Props = {
  activity: ActivitySnapshot
  /** Queue rows from other groups are dimmed. */
  group?: string
}

const reasons: Record<string, string> = { webhook: 'push', auto: 'auto', redeploy: 'redeploy', create: 'new' }

/** What runs after the current build. The running build itself lives in the top bar and on its card. */
export function DeployQueue({ activity, group }: Props) {
  const queue = activity.queue || []
  if (!queue.length) return null

  return (
    <section
      className="queue-enter flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-box border border-warning/30 bg-warning/5 px-3 py-2"
      aria-label="Queued deploys"
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
        <Clock className="h-3.5 w-3.5 text-warning" aria-hidden />
        Up next
      </span>
      <ol className="list-none m-0 p-0 flex flex-wrap gap-1.5 min-w-0">
        {queue.map((item) => (
          <QueueRow key={item.id} item={item} dim={!!group && item.group !== group} />
        ))}
      </ol>
      <span className={`ml-auto text-xs ${muted}`}>Builds run one at a time</span>
    </section>
  )
}

function QueueRow({ item, dim }: { item: QueueItem; dim?: boolean }) {
  const to = item.pending_create
    ? `/projects/${encodeURIComponent(item.group)}`
    : `/projects/${encodeURIComponent(item.group)}/${encodeURIComponent(item.slug)}`
  return (
    <li className={`queue-row ${dim ? 'opacity-55' : ''}`}>
      <Link
        to={to}
        title={item.title}
        className="inline-flex items-center gap-1.5 rounded-field border border-base-300 bg-base-100 px-2 py-1 text-xs transition-colors hover:border-warning/60"
      >
        <span className="font-mono tabular-nums text-warning">{item.position}</span>
        <strong className="font-semibold truncate max-w-40">{item.name || item.slug}</strong>
        <span className={muted}>{reasons[item.reason || ''] || 'deploy'}</span>
      </Link>
    </li>
  )
}
