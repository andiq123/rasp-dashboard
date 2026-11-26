import { CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber/AnimatedNumber'
import { SwapBlock } from '@/components/ui/SwapText/SwapText'
import { fmtMB, type HostCapacity, type Reserved } from '@/lib/resources'

type Usage = { memory_mb: number; cpus: number }

const fmtCores = (n: number) => `${n.toFixed(1)} cores`
const pct = (part: number, total: number) => (total > 0 ? Math.max(0, Math.min(100, (part / total) * 100)) : 0)

/**
 * One bar, with every color named right below it: what apps use (and their
 * limit, the dashed line), what the Pi itself uses, and what is free.
 */
function UsageBar({
  label, total, apps, system, reserved, format,
}: { label: string; total: number; apps: number; system: number; reserved: number; format: (n: number) => string }) {
  const free = Math.max(0, total - apps - system)
  const left = total - reserved
  const limitPct = pct(reserved, total)
  return (
    <div className="ru-row">
      <div className="ru-head">
        <span className="ru-label">{label}</span>
        <span className="ru-total">{format(total)} total</span>
      </div>
      <div className="ru-bar" role="img" aria-label={`${label}: apps ${format(apps)}, Pi system ${format(system)}, free ${format(free)}; app limits ${format(reserved)}`}>
        <span className="ru-seg is-apps" style={{ width: `${pct(apps, total)}%` }} />
        <span className="ru-seg is-system" style={{ left: `${pct(apps, total)}%`, width: `${pct(system, total)}%` }} />
        {reserved > 0 ? <span className={`ru-limit${left < 0 ? ' is-over' : ''}`} style={{ left: `${Math.min(limitPct, 99.5)}%` }} /> : null}
      </div>
      <dl className="ru-legend">
        <div>
          <dt><i className="ru-key is-apps" />Apps</dt>
          <dd><b><AnimatedNumber value={apps} format={format} /></b></dd>
          <dd className="ru-why">{reserved > 0 ? <>{Math.round(pct(apps, reserved))}% of their {format(reserved)} limit <span className="ru-dash" aria-hidden /></> : 'No limits set'}</dd>
        </div>
        <div>
          <dt><i className="ru-key is-system" />Pi system</dt>
          <dd><b><AnimatedNumber value={system} format={format} /></b></dd>
          <dd className="ru-why">OS, Docker, databases</dd>
        </div>
        <div>
          <dt><i className="ru-key is-free" />Free</dt>
          <dd><b><AnimatedNumber value={free} format={format} /></b></dd>
          <dd className={`ru-why${left < 0 ? ' ru-over' : ''}`}>{left >= 0 ? `${format(left)} can still be reserved` : `Limits exceed the Pi by ${format(-left)}`}</dd>
        </div>
      </dl>
    </div>
  )
}

function verdict(host: HostCapacity, reserved: Reserved, used: Usage): { tone: 'ok' | 'warn' | 'bad' | 'busy'; icon: LucideIcon; text: string } {
  if (host.total_mb && reserved.memory_mb > host.total_mb)
    return { tone: 'bad', icon: TriangleAlert, text: 'App memory limits add up to more than the Pi has. If apps grow to their limits, the hotspot can slow down.' }
  if (host.total_mb && host.live_free_mb < host.total_mb * 0.12)
    return { tone: 'warn', icon: TriangleAlert, text: 'Memory is nearly full. New deploys may fail until something stops.' }
  if (host.cores && reserved.cpus > host.cores)
    return { tone: 'busy', icon: Info, text: 'CPU limits exceed the cores, which is fine: apps share CPU time only when busy.' }
  if (!reserved.dedicated_services)
    return { tone: 'ok', icon: CircleCheck, text: 'No apps reserve resources yet. The Pi is all yours.' }
  return {
    tone: 'ok', icon: CircleCheck,
    text: `Apps actually use ${Math.round(pct(used.memory_mb, reserved.memory_mb))}% of the memory reserved for them, so the hotspot has plenty of room.`,
  }
}

/** Real usage against reserved limits, on the Pi's own scale. */
export function ResourceUsage({ host, reserved, used }: { host: HostCapacity; reserved: Reserved; used: Usage }) {
  const memSystem = Math.max(0, host.live_used_mb - used.memory_mb)
  const cpuBusy = (host.cores * host.live_busy_percent) / 100
  const cpuSystem = Math.max(0, cpuBusy - used.cpus)
  const v = verdict(host, reserved, used)
  return (
    <div className="ru">
      <UsageBar label="Memory" total={host.total_mb} apps={used.memory_mb} system={memSystem} reserved={reserved.memory_mb} format={fmtMB} />
      <UsageBar label="CPU" total={host.cores} apps={used.cpus} system={cpuSystem} reserved={reserved.cpus} format={fmtCores} />
      <p className={`ru-verdict tone-${v.tone}`}>
        <v.icon aria-hidden />
        <SwapBlock className="min-w-0 flex-1">{v.text}</SwapBlock>
      </p>
    </div>
  )
}
