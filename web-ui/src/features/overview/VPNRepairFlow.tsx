import { useEffect, useState } from 'react'
import { CheckCircle2, CircleStop, Clock3, Loader2, RotateCw, TriangleAlert } from 'lucide-react'
import type { VPNRepair } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { muted } from '@/lib/ui'

const steps = ['Detect', 'Relay list', 'Select relay', 'Restart', 'Verify']
const phaseSteps: Record<string, number> = {
  preparing: 0, fetching: 1, selected: 2, rotating: 2,
  restarting: 3, repairing: 3, verifying: 4, verified: 4,
}

export function retryLabel(at: string | undefined, now: number): string {
  const target = Date.parse(at || '')
  if (!Number.isFinite(target)) return 'Automatic retry waits for an unhealthy connection.'
  const seconds = Math.max(0, Math.ceil((target - now) / 1000))
  if (!seconds) return 'Checking whether another retry is needed…'
  const time = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
  return `Automatic retry in ${time}, if the connection is still unhealthy.`
}

type Props = {
  repair: VPNRepair
  healthy: boolean
  onRetry: () => void
  loading?: boolean
  disabled?: boolean
}

export function VPNRepairFlow({ repair, healthy, onRetry, loading, disabled }: Props) {
  const [now, setNow] = useState(() => Date.now())
  const failed = repair.phase === 'failed' && !repair.active
  const restored = (repair.phase === 'recovered' && !repair.active) || (failed && healthy)
  const verified = (repair.phase === 'verified' && !repair.active) || restored
  const scheduled = repair.phase === 'scheduled' && !repair.active
  const cancelled = repair.phase === 'cancelled' && !repair.active
  const waiting = (failed || scheduled) && !verified

  useEffect(() => {
    const target = Date.parse(repair.next_retry_at || '')
    setNow(Date.now())
    if (!repair.active && (!waiting || !Number.isFinite(target) || target <= Date.now())) return
    // One timer in this card; never rerender the entire live dashboard per second.
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (!repair.active && current >= target) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [repair.active, repair.started_at, repair.next_retry_at, waiting])

  const phase = failed ? repair.failed_phase : repair.phase
  const step = phaseSteps[phase || '']
  const showSteps = step !== undefined && !scheduled && !cancelled && !restored
  const started = Date.parse(repair.started_at || '')
  const elapsed = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0
  const Icon = verified ? CheckCircle2 : failed ? TriangleAlert : cancelled ? CircleStop : scheduled ? Clock3 : Loader2
  const tone = verified ? 'success' : failed ? 'error' : cancelled ? 'neutral' : 'info'
  const colors = tone === 'success' ? 'border-success/25 bg-success/5 text-success'
    : tone === 'error' ? 'border-error/25 bg-error/5 text-error'
      : tone === 'neutral' ? 'border-base-300 bg-base-200/50 text-base-content'
        : 'border-info/25 bg-info/5 text-info'
  const title = restored ? 'VPN connection restored' : verified ? 'VPN connection verified'
    : failed ? 'VPN repair needs attention' : scheduled ? 'VPN repair scheduled'
      : cancelled ? 'VPN repair stopped' : 'Recovering Mullvad'

  return (
    <section className={`rounded-2xl border p-4 grid gap-3 min-w-0 ${colors}`} aria-label="VPN recovery">
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${repair.active ? 'animate-spin' : ''}`} aria-hidden />
        <div className="flex-1 min-w-0" role="status">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm text-base-content">{title}</strong>
            <span className="badge badge-xs badge-ghost text-base-content/65">{repair.automatic ? 'Auto repair' : 'Manual repair'}</span>
            {!!repair.attempt && <span className={`text-xs ${muted}`}>Attempt {repair.attempt}</span>}
          </div>
          <p className={`text-xs leading-relaxed m-0 mt-1 ${failed && !restored ? 'text-error' : muted}`}>
            {restored ? 'The connection is healthy again. No retry is needed.'
              : repair.error || repair.message || (scheduled ? 'Waiting for a stable failure before repairing.' : 'Preparing recovery…')}
          </p>
        </div>
        {repair.active && Number.isFinite(started) ? <span className={`text-xs font-mono tabular-nums ${muted}`} aria-live="off">{elapsed}s</span> : null}
      </div>

      {showSteps ? (
        <ol className="flex flex-wrap gap-1.5 list-none m-0 p-0" aria-label="VPN recovery stages">
          {steps.map((label, index) => {
            const done = verified || index < step
            const stopped = failed && index === step
            const active = !!repair.active && index === step
            return (
              <li key={label} aria-current={active ? 'step' : undefined}
                aria-label={`${label}: ${done ? 'completed' : stopped ? 'failed' : active ? 'in progress' : 'pending'}`}
                className={`badge badge-sm gap-1 ${done ? 'badge-success badge-soft' : stopped ? 'badge-error badge-soft' : active ? 'badge-info badge-soft' : 'badge-ghost'}`}>
                {done ? <CheckCircle2 size={12} aria-hidden /> : stopped ? <TriangleAlert size={12} aria-hidden /> : null}
                {label}
              </li>
            )
          })}
        </ol>
      ) : null}

      {waiting ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-current/10 pt-3">
          <p className={`text-xs m-0 flex-1 min-w-[160px] ${muted}`} aria-live="off">{retryLabel(repair.next_retry_at, now)}</p>
          <Button variant="primary" icon={<RotateCw size={14} aria-hidden />} loading={loading}
            disabled={disabled || !!repair.active} onClick={onRetry}>
            {failed ? 'Retry now' : 'Repair now'}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
