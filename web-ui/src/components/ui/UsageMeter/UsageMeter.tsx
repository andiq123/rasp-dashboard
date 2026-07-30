import type { RuntimeStats } from '@/api/types'
import { muted } from '@/lib/ui'

type MeterProps = {
  label: string
  usedLabel: string
  limitLabel: string
  percent: number
  tone?: 'mem' | 'cpu'
  hint?: string
  compact?: boolean
}

function fillClass(tone: MeterProps['tone'], over: boolean, warn: boolean): string {
  if (over) return 'bg-error'
  if (warn) return 'bg-warning'
  return tone === 'cpu' ? 'bg-info' : 'bg-primary'
}

/** Smooth live usage bar — width transitions between SSE samples. */
export function UsageMeter({
  label,
  usedLabel,
  limitLabel,
  percent,
  tone = 'mem',
  hint,
  compact,
}: MeterProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0))
  const over = pct >= 92
  const warn = !over && pct >= 75
  return (
    <div className={`grid ${compact ? 'gap-1' : 'gap-1.5'} min-w-0`}>
      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <span
          className={`uppercase tracking-wide font-bold ${muted} ${
            compact ? 'text-[10px]' : 'text-[11px]'
          }`}
        >
          {label}
        </span>
        <span
          className={`font-mono tabular-nums shrink-0 font-semibold ${
            compact ? 'text-[11px]' : 'text-xs'
          } ${over ? 'text-error' : 'text-base-content'}`}
        >
          {usedLabel}
          <span className={`font-medium ${muted}`}> / {limitLabel}</span>
        </span>
      </div>
      <div
        className={`relative w-full rounded-full bg-base-300/70 overflow-hidden ${
          compact ? 'h-1.5' : 'h-2'
        }`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={`${label} ${usedLabel} of ${limitLabel}`}
      >
        <div
          className={`usage-fill absolute inset-y-0 left-0 rounded-full ${fillClass(tone, over, warn)}`}
          style={{ width: `${pct}%` }}
        />
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'linear-gradient(90deg, transparent, color-mix(in oklab, white 22%, transparent), transparent)',
            backgroundSize: '200% 100%',
          }}
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

/** Live CPU + memory meters for one service (SSE-backed RuntimeStats). */
export function ServiceUsage({
  stats,
  compact,
  fallbackMem,
  fallbackCpu,
  live,
}: {
  stats?: RuntimeStats | null
  compact?: boolean
  fallbackMem?: number
  fallbackCpu?: number
  /** Show a subtle live pulse when SSE is connected. */
  live?: boolean
}) {
  if (!stats) return null

  const limitMem = stats.limit_mb && stats.limit_mb > 0 ? stats.limit_mb : fallbackMem || 0
  const limitCpu = stats.limit_cpus && stats.limit_cpus > 0 ? stats.limit_cpus : fallbackCpu || 0
  const memUsed = Number(stats.memory_mb) || 0
  const cpuUsed = Number(stats.cpu_percent) || 0
  const memPct = limitMem > 0 ? (memUsed / limitMem) * 100 : 0
  const cpuCap = limitCpu > 0 ? limitCpu * 100 : 100
  const cpuPct = (cpuUsed / cpuCap) * 100

  return (
    <div
      className={`grid min-w-0 ${
        compact
          ? 'gap-1.5'
          : 'gap-3 p-3 rounded-box border border-base-300/80 bg-gradient-to-br from-base-100 to-base-200/80'
      }`}
    >
      {!compact ? (
        <div className="flex items-center justify-between gap-2">
          <strong className="text-xs m-0 tracking-tight">Live usage</strong>
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${muted}`}>
            {live ? (
              <>
                <span className="status status-success status-sm" />
                streaming
              </>
            ) : (
              <>
                <span className="status status-warning status-sm" />
                polling
              </>
            )}
            {stats.shared ? ' · shared' : ''}
          </span>
        </div>
      ) : null}
      <ServiceUsageMeters
        compact={compact}
        memUsed={memUsed}
        memPct={memPct}
        limitMem={limitMem}
        cpuUsed={cpuUsed}
        cpuPct={cpuPct}
        limitCpu={limitCpu}
        hint={!compact}
        shared={!!stats.shared}
        source={stats.source}
      />
    </div>
  )
}

function ServiceUsageMeters({
  compact,
  memUsed,
  memPct,
  limitMem,
  cpuUsed,
  cpuPct,
  limitCpu,
  hint,
  shared,
  source,
}: {
  compact?: boolean
  memUsed: number
  memPct: number
  limitMem: number
  cpuUsed: number
  cpuPct: number
  limitCpu: number
  hint?: boolean
  shared?: boolean
  source?: string
}) {
  return (
    <div className={`grid ${compact ? 'gap-1.5' : 'gap-2.5'} min-w-0`}>
      <UsageMeter
        compact={compact}
        tone="mem"
        label="Memory"
        usedLabel={fmtMem(memUsed)}
        limitLabel={limitMem > 0 ? fmtMem(limitMem) : '—'}
        percent={memPct}
        hint={
          hint
            ? shared
              ? 'Shared engine · live RSS'
              : source
                ? `Live · ${source}`
                : 'Live vs Docker limit'
            : undefined
        }
      />
      <UsageMeter
        compact={compact}
        tone="cpu"
        label="CPU"
        usedLabel={fmtCpu(cpuUsed)}
        limitLabel={limitCpu > 0 ? `${limitCpu}×` : '—'}
        percent={cpuPct}
        hint={hint ? 'Live · % of one core vs CPU limit' : undefined}
      />
    </div>
  )
}
