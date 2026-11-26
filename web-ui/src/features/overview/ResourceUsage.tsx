import { CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber/AnimatedNumber'
import { SwapBlock } from '@/components/ui/SwapText/SwapText'
import { fmtMB, type HostCapacity, type Reserved } from '@/lib/resources'

type Usage = { memory_mb: number; cpus: number }

const fmtCores = (n: number) => `${n.toFixed(1)} cores`
const pct = (part: number, total: number) => (total > 0 ? Math.max(0, Math.min(100, (part / total) * 100)) : 0)

/**
 * Two lanes on the same scale: what is actually in use right now, and what is
 * promised to apps as limits. The gap between them is what new apps can reserve.
 */
function UsageBar({
  label, total, apps, system, reserved, format,
}: { label: string; total: number; apps: number; system: number; reserved: number; format: (n: number) => string }) {
  const left = total - reserved
  return (
    <div className="ru-row">
      <div className="ru-head">
        <span className="ru-label">{label}</span>
        <span className="ru-total">{format(total)} total</span>
      </div>
      <div className="ru-lane">
        <span className="ru-lane-label">Used now</span>
        <div className="ru-bar" role="img" aria-label={`${label} used now: apps ${format(apps)}, system ${format(system)}, of ${format(total)}`}>
          <span className="ru-seg is-apps" style={{ width: `${pct(apps, total)}%` }} />
          <span className="ru-seg is-system" style={{ left: `${pct(apps, total)}%`, width: `${pct(system, total)}%` }} />
        </div>
        <span className="ru-lane-value"><AnimatedNumber value={apps + system} format={format} /></span>
      </div>
      <div className="ru-lane">
        <span className="ru-lane-label">Reserved</span>
        <div className="ru-bar" role="img" aria-label={`${label} reserved for apps: ${format(reserved)} of ${format(total)}`}>
          <span className={`ru-reserved${left < 0 ? ' is-over' : ''}`} style={{ width: `${pct(reserved, total)}%` }} />
        </div>
        <span className="ru-lane-value">{format(reserved)}</span>
      </div>
      <p className="meta ru-meta">
        <span><i className="ru-key is-apps" />Apps <b><AnimatedNumber value={apps} format={format} /></b></span>
        <span><i className="ru-key is-system" />System <b><AnimatedNumber value={system} format={format} /></b></span>
        <span className={`meta-end${left < 0 ? ' ru-over' : ''}`}>
          {left >= 0 ? <><b>{format(left)}</b> left to reserve</> : <><b>{format(-left)}</b> over the Pi</>}
        </span>
      </p>
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
