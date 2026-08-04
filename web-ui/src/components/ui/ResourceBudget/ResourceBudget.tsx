import { muted } from '@/lib/ui'
import type { HostCapacity, Reserved } from '@/lib/resources'

type Props = {
  host: HostCapacity
  reserved: Reserved
  /** When editing one service, show its draft share. */
  draftLabel?: string
  compact?: boolean
}

function Bar({
  label,
  used,
  total,
  unit,
  detail,
}: {
  label: string
  used: number
  total: number
  unit: string
  detail: string
}) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0
  const over = total > 0 && used > total
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">{label}</span>
        <span className={`text-xs font-mono ${over ? 'text-error' : muted}`}>
          {used}
          {unit} / {total || '—'}
          {unit}
        </span>
      </div>
      <progress
        className={`progress w-full h-2 ${over ? 'progress-error' : pct > 85 ? 'progress-warning' : 'progress-primary'}`}
        value={pct}
        max={100}
      />
      <p className={`text-[11px] m-0 ${muted}`}>{detail}</p>
    </div>
  )
}

/** Reserved dedicated-container limits vs Pi host capacity (OS overhead not included). */
export function ResourceBudget({ host, reserved, draftLabel, compact }: Props) {
  const memLeft = host.total_mb > 0 ? host.total_mb - reserved.memory_mb : null
  const cpuLeft = host.cores > 0 ? Math.round((host.cores - reserved.cpus) * 10) / 10 : null

  return (
    <div className={`grid gap-2.5 ${compact ? '' : 'p-2.5 rounded-box border border-base-300 bg-base-200/50'}`}>
      {!compact ? (
        <div className="flex items-baseline justify-between gap-2">
          <strong className="text-xs m-0">Pi capacity</strong>
          <span className={`text-[11px] ${muted}`}>
            {reserved.dedicated_services} dedicated service{reserved.dedicated_services === 1 ? '' : 's'}
            {draftLabel ? ` · ${draftLabel}` : ''}
          </span>
        </div>
      ) : null}
      <Bar
        label="Memory reserved"
        used={reserved.memory_mb}
        total={host.total_mb}
        unit="MB"
        detail={
          memLeft == null
            ? 'Host memory unknown'
            : memLeft < 0
              ? `Overcommitted by ${Math.abs(memLeft)}MB — limits may thrash`
              : `${memLeft}MB headroom · live free ~${host.live_free_mb}MB`
        }
      />
      <Bar
        label="CPU reserved"
        used={reserved.cpus}
        total={host.cores}
        unit=""
        detail={
          cpuLeft == null
            ? 'Core count unknown'
            : cpuLeft < 0
              ? `Overcommitted by ${Math.abs(cpuLeft)} cores`
              : `${cpuLeft} cores free · live busy ${Math.round(host.live_busy_percent)}%`
        }
      />
      <p className={`text-[11px] m-0 ${muted}`}>
        Reserved = Docker limits for Go apps. OS, Postgres, and Docker themselves use extra RAM/CPU.
      </p>
    </div>
  )
}
