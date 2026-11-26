import { CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber/AnimatedNumber'
import { SwapBlock } from '@/components/ui/SwapText/SwapText'
import { fmtMB, type HostCapacity, type Reserved } from '@/lib/resources'

type Usage = { memory_mb: number; cpus: number }

const fmtCores = (n: number) => `${n.toFixed(1)} cores`
const pct = (part: number, total: number) => (total > 0 ? Math.max(0, Math.min(100, (part / total) * 100)) : 0)

function UsageBar({
  label, total, apps, system, reserved, format,
}: { label: string; total: number; apps: number; system: number; reserved: number; format: (n: number) => string }) {
  const free = Math.max(0, total - apps - system)
  const appsPct = pct(apps, total)
  const systemPct = pct(system, total)
  return (
    <div className="ru-row">
      <div className="ru-head">
        <span className="ru-label">{label}</span>
        <span className="ru-free"><AnimatedNumber value={free} format={format} /> free of {format(total)}</span>
      </div>
      <div className="ru-bar" role="img" aria-label={`${label}: apps use ${format(apps)} of ${format(reserved)} reserved, system uses ${format(system)}, ${format(free)} free`}>
        <span className={`ru-reserved${reserved > total ? ' is-over' : ''}`} style={{ width: `${pct(reserved, total)}%` }} />
        <span className="ru-seg is-apps" style={{ width: `${appsPct}%` }} />
        <span className="ru-seg is-system" style={{ left: `${appsPct}%`, width: `${systemPct}%` }} />
      </div>
      <div className="ru-meta">
        <span><i className="ru-key is-apps" />Apps <b><AnimatedNumber value={apps} format={format} /></b> of {format(reserved)} reserved</span>
        <span><i className="ru-key is-system" />System <b><AnimatedNumber value={system} format={format} /></b></span>
      </div>
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
    text: `Apps use ${Math.round(pct(used.memory_mb, reserved.memory_mb))}% of their memory limits, leaving room for the hotspot.`,
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
