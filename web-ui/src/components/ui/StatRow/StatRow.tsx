import type { LucideIcon } from 'lucide-react'

type Props = {
  icon: LucideIcon
  label: string
  detail?: string
  value: string
  /** 0–100; drives the bar and, with the thresholds, its tone. */
  percent: number
  warnAt?: number
  badAt?: number
}

export function statTone(percent: number, warnAt = 75, badAt = 90): string {
  return percent >= badAt ? 'tone-bad' : percent >= warnAt ? 'tone-warn' : ''
}

/** One metric on one line: icon, label, live bar, value. */
export function StatRow({ icon: Icon, label, detail, value, percent, warnAt, badAt }: Props) {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0))
  return (
    <div className={`metric-row ${statTone(p, warnAt, badAt)}`}>
      <Icon aria-hidden />
      <span className="metric-label">
        {label}
        {detail ? <small>{detail}</small> : null}
      </span>
      <span className="metric-track" role="meter" aria-label={label} aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
        <span className="metric-fill block" style={{ width: `${p}%` }} />
      </span>
      <span className="metric-value">{value}</span>
    </div>
  )
}
