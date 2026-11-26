import { ExternalLink, ShieldCheck } from 'lucide-react'
import type { MullvadAccount } from '@/api/types'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber/AnimatedNumber'
import { Popover } from '@/components/ui/Popover/Popover'
import { daysLeftTone, expiryDate, MULLVAD_ACCOUNT_URL } from '@/lib/mullvad'

const RING = 2 * Math.PI * 8 // circumference for r=8

/** Compact subscription chip: a ring of the time left and the day count. */
export function MullvadTime({ account }: { account?: MullvadAccount }) {
  if (!account?.configured || account.days_left == null) return null
  const days = account.days_left
  const tone = daysLeftTone(account) || 'idle'
  const fill = Math.max(0, Math.min(1, days / 31))
  const label = days < 0 ? 'Expired' : days === 0 ? 'Ends today' : null
  return (
    <Popover
      label="Mullvad subscription"
      align="end"
      content={
        <div className="pop-body">
          <div className="pop-head">
            <strong>Mullvad time</strong>
            <span className={`pop-state tone-${tone}`}>{label || `${days} ${days === 1 ? 'day' : 'days'} left`}</span>
          </div>
          <p className="pop-line">
            Paid until {expiryDate(account)}. When it runs out, the Romanian tunnel stops and the hotspot has no internet.
          </p>
          <a className={`btn btn-sm ${tone === 'ok' ? 'btn-ghost' : 'btn-primary'} justify-self-start`} href={MULLVAD_ACCOUNT_URL} target="_blank" rel="noreferrer">
            Add time <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      }
    >
      <span className={`time-chip tone-${tone}`}>
        <svg viewBox="0 0 20 20" className="time-ring" aria-hidden>
          <circle cx="10" cy="10" r="8" className="time-ring-track" />
          <circle cx="10" cy="10" r="8" className="time-ring-fill" strokeDasharray={RING} strokeDashoffset={RING * (1 - fill)} />
        </svg>
        <ShieldCheck className="time-icon" aria-hidden />
        {label ? (
          <span>{label}</span>
        ) : (
          <span>
            <b><AnimatedNumber value={days} format={(v) => String(Math.round(v))} /></b> {days === 1 ? 'day' : 'days'} left
          </span>
        )}
      </span>
    </Popover>
  )
}
