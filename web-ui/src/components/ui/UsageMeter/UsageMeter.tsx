import type { RuntimeStats } from '@/api/types'
import { muted } from '@/lib/ui'

type MeterProps = {
  label: string
  usedLabel: string
  limitLabel: string
  percent: number
  tone?: 'primary' | 'warning' | 'error' | 'info'
  hint?: string
  compact?: boolean
}

function toneClass(tone: MeterProps['tone'], over: boolean): string {
  if (over) return 'bg-error'
  switch (tone) {
    case 'warning':
      return 'bg-warning'
    case 'error':
      return 'bg-error'
    case 'info':
      return 'bg-info'
    default:
      return 'bg-primary'
  }
}

/** Smooth live usage bar — width transitions between samples. */
export function UsageMeter({
  label,
  usedLabel,
  limitLabel,
  percent,
  tone = 'primary',
  hint,
  compact,
}: MeterProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0))
  const over = pct >= 92
  const warn = !over && pct >= 75
  return (
    <div className={`grid ${compact ? 'gap-0.5' : 'gap-1'} min-w-0`}>
      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <span className={`font-semibold truncate ${compact ? 'text-[10px]' : 'text-xs'}`}>{label}</span>
        <span
          className={`font-mono tabular-nums shrink-0 ${compact ? 'text-[10px]' : 'text-xs'} ${
            over ? 'text-error' : muted
          }`}
        >
          {usedLabel}
          <span className="opacity-50"> / {limitLabel}</span>
        </span>
      </div>
      <div
        className={`w-full rounded-full bg-base-300/80 overflow-hidden ${compact ? 'h-1' : 'h-1.5'}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={`${label} ${usedLabel} of ${limitLabel}`}
      >
        <div
          className={`usage-fill h-full rounded-full ${toneClass(over ? 'error' : warn ? 'warning' : tone, over)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {hint && !compact ? <p className={`text-[11px] m-0 ${muted}`}>{hint}</p> : null}
    </div>
  )
}

function fmtMem(mb: number): string {
  if (!Number.isFinite(mb) || mb < 0) return '—'
  if (mb < 10) return `${mb.toFixed(1)}MB`
  return `${Math.round(mb)}MB`
}

function fmtCpu(percentOfOneCore: number): string {
  if (!Number.isFinite(percentOfOneCore) || percentOfOneCore < 0) return '—'
  if (percentOfOneCore < 10) return `${percentOfOneCore.toFixed(1)}%`
  return `${Math.round(percentOfOneCore)}%`
}

/** Live CPU + memory meters for one service (from RuntimeStats). */
export function ServiceUsage({
  stats,
  compact,
  fallbackMem,
  fallbackCpu,
}: {
  stats?: RuntimeStats | null
  compact?: boolean
  /** Configured limits when stats omit them. */
  fallbackMem?: number
  fallbackCpu?: number
}) {
  if (!stats) return null

  const limitMem = stats.limit_mb && stats.limit_mb > 0 ? stats.limit_mb : fallbackMem || 0
  const limitCpu = stats.limit_cpus && stats.limit_cpus > 0 ? stats.limit_cpus : fallbackCpu || 0
  const memUsed = Number(stats.memory_mb) || 0
  const cpuUsed = Number(stats.cpu_percent) || 0
  const memPct = limitMem > 0 ? (memUsed / limitMem) * 100 : 0
  // CPU% is relative to one core; capacity = limit_cpus * 100.
  const cpuCap = limitCpu > 0 ? limitCpu * 100 : 100
  const cpuPct = (cpuUsed / cpuCap) * 100

  return (
    <div className={`grid ${compact ? 'gap-1' : 'gap-2.5'} min-w-0`}>
      <UsageMeter
        compact={compact}
        label="Memory"
        usedLabel={fmtMem(memUsed)}
        limitLabel={limitMem > 0 ? fmtMem(limitMem) : '—'}
        percent={memPct}
        hint={
          compact
            ? undefined
            : stats.shared
              ? 'Shared engine · live RSS'
              : stats.source
                ? `Live · ${stats.source}`
                : 'Live usage'
        }
      />
      <UsageMeter
        compact={compact}
        label="CPU"
        usedLabel={fmtCpu(cpuUsed)}
        limitLabel={limitCpu > 0 ? `${limitCpu}×` : '—'}
        percent={cpuPct}
        tone="info"
        hint={compact ? undefined : 'Live · % of one core vs CPU limit'}
      />
    </div>
  )
}
