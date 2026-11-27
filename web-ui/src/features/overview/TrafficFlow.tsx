import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Ban, Cable, Cloud, Cpu, Globe, Package, Lock, ShieldCheck, ShieldOff, Smartphone, Waypoints, Wifi, type LucideIcon } from 'lucide-react'
import type { AppState } from '@/api/types'
import { AnimatedList } from '@/components/ui/AnimatedList/AnimatedList'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber/AnimatedNumber'
import { fmtMbps, fmtRate as fmtBytesRate } from '@/lib/format'
import { Popover } from '@/components/ui/Popover/Popover'
import { SwapText } from '@/components/ui/SwapText/SwapText'
import { FlowInfo } from './FlowInfo'

export type NodeState = 'ok' | 'bad' | 'busy' | 'idle'
/** flow: traffic moving · blocked: stopped at the next hop · busy: being repaired · idle: nothing to carry */
export type LinkState = 'flow' | 'blocked' | 'busy' | 'idle'

/** Which route a piece of traffic takes: the shared uplink, the Wi‑Fi gate (VPN or proxy), or apps going direct. */
export type Scope = 'uplink' | 'tunnel' | 'proxy' | 'direct'
export type FlowNode = { id: string; label: string; detail: string; state: NodeState; icon: LucideIcon; active?: boolean; scope?: Scope }

/** Above this rate a node counts as actively requesting data. */
export const ACTIVE_BPS = 4_000
/** Live rate on one link: `down` travels to whoever asked, `up` toward the internet. */
export type LinkRate = { down: number; up: number }
type Span = { left: number; width: number }
/** An action the pointer is resting on, previewed on the circuit before it runs. */
export type FlowPreview = 'stop' | 'restart' | 'repair' | 'switch'
const previewSteps: Record<FlowPreview, string[]> = {
  stop: ['wifi', 'devices'],
  restart: ['wifi', 'devices'],
  repair: ['mullvad'],
  switch: ['mullvad', 'residential', 'wifi', 'devices'],
}
export type Flow = { nodes: FlowNode[]; links: LinkState[]; rates: LinkRate[]; gateScope: Scope }

export type TrafficLevel = 0 | 1 | 2 | 3 | 4
const MB = 1_000_000

/**
 * Traffic level from bytes/s: idle (under 4 KB/s), light (under 1 MB/s),
 * busy (1–10 MB/s), heavy (10–20 MB/s), saturating (above 20 MB/s).
 */
export function trafficLevel(bps: number): TrafficLevel {
  if (bps >= 20 * MB) return 4
  if (bps >= 10 * MB) return 3
  if (bps >= MB) return 2
  if (bps >= ACTIVE_BPS) return 1
  return 0
}

// Calm and honest: browsing drifts slowly; only real downloads look fast.
// Discrete steps, so small rate changes never restart the motion.
const levelDuration = [3.6, 3.6, 2.2, 1.3, 0.8]
// Idle lanes keep their packets mounted but faded, so traffic starting or
// stopping cross-fades instead of popping. Heavier traffic means denser packets.
const levelPackets = [2, 2, 3, 4, 5]

function fmtRate(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`
  if (bps >= 1_000) return `${Math.round(bps / 1_000)} KB/s`
  return `${Math.round(bps)} B/s`
}

/**
 * The path internet takes from the Pi's uplink to the devices on its Wi‑Fi.
 * A link carries traffic only while everything before it carries traffic, so
 * the diagram shows exactly where the flow stops.
 */
export function computeFlow(state: AppState, recovering: boolean, switchingTo?: 'mullvad' | 'residential'): Flow {
  const mode = switchingTo ?? (state.mode === 'residential' ? 'residential' : 'mullvad')
  const switching = !!switchingTo
  const uplink = state.uplink
  const vpn = state.vpn_health || {}
  const known = !!state.generated_at
  const uplinkKnown = known && !!uplink?.checked
  const clients = state.clients ?? 0

  const gateScope: Scope = mode === 'mullvad' ? 'tunnel' : 'proxy'
  const gateOk = mode === 'mullvad'
    ? !!(vpn.country_allowed && vpn.interface_up && vpn.handshake_healthy && vpn.egress_ok)
    : !!state.proxy_running

  const nodes: FlowNode[] = [
    {
      id: 'internet', label: 'Internet', icon: Globe, scope: 'uplink',
      detail: !uplinkKnown ? 'Checking…' : uplink?.internet ? 'Reachable' : 'Unreachable',
      state: !uplinkKnown ? 'idle' : uplink?.internet ? 'ok' : 'bad',
    },
    {
      id: 'uplink', label: 'Ethernet in', icon: Cable, scope: 'uplink',
      detail: !known ? 'Checking…' : uplink?.link_up ? 'Connected' : 'No cable',
      state: !known ? 'idle' : uplink?.link_up ? 'ok' : 'bad',
    },
    { id: 'pi', label: 'Pi', icon: Cpu, scope: 'uplink', detail: 'Splits traffic', state: known ? 'ok' : 'idle' },
    mode === 'mullvad'
      ? {
          id: 'mullvad', label: 'Mullvad', icon: ShieldCheck, scope: 'tunnel',
          detail: switching ? 'Switching' : recovering ? 'Repairing' : gateOk ? 'Romania' : !vpn.country_allowed ? 'Not Romania' : vpn.interface_up ? 'Not verified' : 'Tunnel down',
          state: !known ? 'idle' : switching || recovering ? 'busy' : gateOk ? 'ok' : 'bad',
        }
      : {
          id: 'residential', label: 'Residential', icon: Waypoints, scope: 'proxy',
          detail: switching ? 'Switching' : gateOk ? 'Running' : 'Stopped',
          state: !known ? 'idle' : switching ? 'busy' : gateOk ? 'ok' : 'bad',
        },
    {
      id: 'wifi', label: 'Wi‑Fi out', icon: Wifi, scope: gateScope,
      detail: state.hotspot_running ? state.ssid || 'Broadcasting' : 'Stopped',
      state: !known ? 'idle' : state.hotspot_running ? 'ok' : 'bad',
    },
    {
      id: 'devices', label: 'Devices', icon: Smartphone, scope: gateScope,
      detail: !state.hotspot_running ? 'Offline' : clients === 1 ? '1 device' : clients ? `${clients} devices` : 'None yet',
      state: state.hotspot_running && clients > 0 ? 'ok' : 'idle',
    },
  ]

  const links: LinkState[] = []
  let carrying = nodes[0].state === 'ok'
  for (let i = 1; i < nodes.length; i++) {
    const next = nodes[i]
    if (!carrying) {
      links.push('idle')
      continue
    }
    if (next.state === 'ok') links.push('flow')
    else if (next.state === 'busy') links.push('busy')
    else if (next.state === 'bad') links.push('blocked')
    else links.push('idle') // carrying, but nobody to deliver to (no devices)
    carrying = next.state === 'ok'
  }
  // Each link animates at the speed of the interface that actually carries it:
  // Ethernet for the uplink, the tunnel for Pi → gate (the Pi's own updates
  // use it too), and Wi‑Fi for everything after the gate, so the device side
  // stays calm unless devices are really using it.
  const t = state.traffic || {}
  const uplinkLink: LinkRate = { down: t.uplink_down_bps || 0, up: t.uplink_up_bps || 0 }
  const hotspotLink: LinkRate = { down: t.hotspot_down_bps || 0, up: t.hotspot_up_bps || 0 }
  const gateLink: LinkRate = mode === 'mullvad' ? { down: t.tunnel_down_bps || 0, up: t.tunnel_up_bps || 0 } : hotspotLink
  const hotspotRate = hotspotLink.down + hotspotLink.up
  const gateRate = gateLink.down + gateLink.up
  // Who is asking for data right now: devices (Wi‑Fi traffic) or the Pi itself
  // (tunnel traffic the devices do not explain, e.g. system updates).
  const devices = nodes.find((n) => n.id === 'devices')
  const pi = nodes.find((n) => n.id === 'pi')
  if (devices) devices.active = hotspotRate >= ACTIVE_BPS
  if (pi) pi.active = mode === 'mullvad' && gateRate - hotspotRate * 1.1 >= ACTIVE_BPS
  return { nodes, links, rates: [uplinkLink, uplinkLink, gateLink, hotspotLink, hotspotLink], gateScope }
}

const linkTone: Record<LinkState, string> = { flow: 'tone-ok', blocked: 'tone-bad', busy: 'tone-busy', idle: 'tone-idle' }
const linkLabel: Record<LinkState, string> = { flow: 'traffic flowing', blocked: 'traffic blocked', busy: 'being repaired', idle: 'no traffic' }

/** One lane of a link: a line with an arrowhead and LED-like packets moving its way. */
function Lane({ dir, bps, toward }: { dir: 'in' | 'out'; bps: number; toward: 'start' | 'end' }) {
  const level = trafficLevel(bps)
  return (
    <span className={`lane is-${dir} to-${toward} level-${level}`} style={{ '--flow-dur': `${levelDuration[level]}s` } as React.CSSProperties}>
      <span className="flow-packets">
        {Array.from({ length: levelPackets[level] }, (_, k) => (
          // Evenly spaced along the lane, whatever the count.
          <i key={k} className="flow-packet" style={{ animationDelay: `${(-k * levelDuration[level]) / levelPackets[level]}s` }} />
        ))}
      </span>
    </span>
  )
}

/**
 * A link drawn as a two-lane road. The top lane carries data in toward whoever
 * asked; the bottom lane carries requests out toward the internet. Each lane
 * moves at its own live speed and stays still when quiet.
 */
function FlowLink({ state, rate, scope, requester = 'end', vertical = false }: { state: LinkState; rate: LinkRate; scope: Scope; requester?: 'start' | 'end'; vertical?: boolean }) {
  const away = requester === 'end' ? 'start' : 'end'
  if (state !== 'flow') {
    return (
      <span className={`flow-link is-${state} ${linkTone[state]} scope-${scope}${vertical ? ' is-vertical' : ''}`} aria-hidden title={linkLabel[state]}>
        <span className="flow-packets">{[0, 1].map((k) => <i key={k} className="flow-packet" />)}</span>
        {state === 'blocked' ? <Ban className="flow-barrier" /> : null}
      </span>
    )
  }
  const level = Math.max(trafficLevel(rate.down), trafficLevel(rate.up))
  const title = level === 0 ? 'connected, idle' : `in ${fmtRate(rate.down)}, out ${fmtRate(rate.up)}`
  return (
    <span className={`flow-link is-flow is-road tone-ok scope-${scope} level-${level}${vertical ? ' is-vertical' : ''}`} aria-hidden title={title}>
      <Lane dir="in" bps={rate.down} toward={requester} />
      <Lane dir="out" bps={rate.up} toward={away} />
    </span>
  )
}

/** Apps and their public links, which leave over Ethernet and skip the VPN. */
export type NetUse = { name: string; in: number; out: number; connections: number }
export type FlowBranch = {
  apps: number
  links: number
  liveLinks: number
  internet: boolean
  /** Apps using the internet right now, busiest first. */
  appUse: NetUse[]
  /** Public link (cloudflared) traffic. */
  linkUse: LinkRate
}

function NodeView({ node, info }: { node: FlowNode; info: React.ReactNode }) {
  return (
    <Popover label={`${node.label} details`} align="center" content={info}>
      <span className={`flow-node tone-${node.state} scope-${node.scope}${node.active ? ' is-active' : ''}`}>
        <span className="flow-icon"><node.icon aria-hidden /></span>
        <span className="flow-text">
          <span className="flow-label">{node.label}</span>
          <span className="flow-detail"><SwapText>{node.detail}</SwapText></span>
        </span>
      </span>
    </Popover>
  )
}

function Rates({ rate }: { rate: LinkRate }) {
  return (
    <span className="use-rates">
      <span className="use-rate" title="Data coming in"><ArrowDown aria-hidden />{fmtRate(rate.down)}</span>
      <span className="use-rate is-out" title="Requests going out"><ArrowUp aria-hidden />{fmtRate(rate.up)}</span>
    </span>
  )
}

/** Busiest apps using the internet, one compact row each. */
function UseList({ items }: { items: NetUse[] }) {
  return (
    <ul className="use-list">
      {items.slice(0, 5).map((u) => (
        <li key={u.name}>
          <span className="use-name" title={u.connections === 1 ? '1 connection' : `${u.connections} connections`}>{u.name}</span>
          <Rates rate={{ down: u.in, up: u.out }} />
        </li>
      ))}
    </ul>
  )
}

/**
 * Spur under the Pi: deployed apps run on the Pi itself. Their internet traffic
 * (and visitors arriving through public links via cloudflared) goes back
 * through the Pi and out over Ethernet, never through the VPN.
 */
function Spur({ branch }: { branch: FlowBranch }) {
  const appRate = branch.appUse.reduce<LinkRate>((r, u) => ({ down: r.down + u.in, up: r.up + u.out }), { down: 0, up: 0 })
  const rate: LinkRate = { down: appRate.down + branch.linkUse.down, up: appRate.up + branch.linkUse.up }
  const apps: FlowNode = {
    id: 'apps', label: 'Your apps', icon: Package, scope: 'direct',
    detail: branch.apps === 1 ? '1 running' : `${branch.apps} running`,
    state: branch.apps ? 'ok' : 'idle',
    active: rate.down + rate.up >= ACTIVE_BPS,
  }
  const linksOk = !branch.links || branch.liveLinks === branch.links
  const busy = branch.appUse.filter((u) => u.in + u.out > 0)
  return (
    <div className="flow-spur" aria-label="Apps on the Pi use Ethernet directly, not the VPN">
      <FlowLink state={branch.internet && branch.apps ? 'flow' : 'idle'} rate={rate} scope="direct" requester="end" vertical />
      <NodeView
        node={apps}
        info={
          <div className="pop-body">
            <div className="pop-head"><strong>Your apps</strong><span className="pop-state tone-ok">No VPN</span></div>
            <p className="pop-line">Run on the Pi and reach the internet over Ethernet.</p>
            <div className="pop-section">
              <span className="pop-label"><Package aria-hidden />Using internet</span>
              {busy.length ? <UseList items={busy} /> : <p className="pop-line">None right now</p>}
            </div>
            {branch.links ? (
              <div className="pop-section">
                <span className="pop-label"><Cloud aria-hidden />Public links<em className={linksOk ? '' : 'is-bad'}>{branch.liveLinks}/{branch.links} live</em></span>
                <div className="use-row"><span className="use-name is-muted">Estimated</span><Rates rate={branch.linkUse} /></div>
              </div>
            ) : null}
          </div>
        }
      />
      <span className="spur-scope"><ShieldOff aria-hidden />Direct, no VPN</span>
      {/* Only a problem earns a chip; healthy links need no badge. */}
      {!linksOk ? (
        <span className="spur-tag is-bad" title="Public links live"><Cloud aria-hidden />{branch.links - branch.liveLinks} of {branch.links} links down</span>
      ) : null}
    </div>
  )
}

/** Animated diagram of where traffic flows and where it stops. Every step opens an info popup. */
export function TrafficFlow({ flow, state, branch, branchPending = false, preview, previewText = '' }: { flow: Flow; state: AppState; branch?: FlowBranch; branchPending?: boolean; preview?: FlowPreview | null; previewText?: string }) {
  const last = flow.nodes.length - 1
  const wrap = useRef<HTMLDivElement>(null)
  const [piX, setPiX] = useState(0)
  // Scope brackets above the path, positioned on the measured nodes.
  const [rails, setRails] = useState<{ uplink: Span; gate: Span } | null>(null)
  const layoutKey = flow.nodes.map((n) => n.id).join()
  const net = state.device_metrics?.network || {}
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => {
      const base = el.getBoundingClientRect().left
      const steps = [...el.querySelectorAll<HTMLElement>('.flow > .flow-step')]
      const node = (i: number) => steps[i]?.querySelector<HTMLElement>('.flow-node')?.getBoundingClientRect()
      const link = (i: number) => steps[i]?.querySelector<HTMLElement>(':scope > .flow-link')?.getBoundingClientRect()
      const pi = steps[2]?.querySelector<HTMLElement>('.flow-icon')?.getBoundingClientRect()
      if (pi) setPiX(Math.round(pi.left + pi.width / 2 - base))
      const [n0, n2, l3, n5] = [node(0), node(2), link(3), node(5)]
      const span = (a: number, b: number): Span => ({ left: Math.round(a - base), width: Math.round(b - a) })
      setRails(n0 && n2 && l3 && n5 ? { uplink: span(n0.left, n2.right), gate: span(l3.left, n5.right) } : null)
    }
    measure()
    // Any node changing width (a label swapping, fonts loading) moves everything after it.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.querySelectorAll('.flow .flow-node').forEach((n) => ro.observe(n))
    return () => ro.disconnect()
  }, [layoutKey])
  const tunnel = flow.gateScope === 'tunnel'
  // Keep the last preview text while it fades out, so it never blanks mid-fade.
  const [shownPreview, setShownPreview] = useState(previewText)
  if (previewText && previewText !== shownPreview) setShownPreview(previewText)
  return (
    <div className="flow-wrap" ref={wrap} data-preview={preview || undefined}>
      {/* Who takes which route: one bracket per scope, in that scope's color. */}
      <div className={`scope-rails${preview ? ' is-previewing' : ''}`} aria-hidden>
        {/* Action preview reuses this fixed row: brackets fade out, one line fades in, nothing moves. */}
        <span className={`scope-preview ${preview === 'stop' ? 'tone-bad' : 'tone-warn'}`}>{shownPreview}</span>
        {rails ? (
          <>
            <span className="scope-rail scope-uplink" style={rails.uplink}><Cable />Shared connection</span>
            <span className={`scope-rail scope-${flow.gateScope}`} style={rails.gate}>
              {tunnel ? <Lock /> : <Waypoints />}
              {tunnel ? 'Wi‑Fi devices, encrypted to Romania' : 'Wi‑Fi devices, through the residential proxy'}
            </span>
          </>
        ) : null}
      </div>
    <ol className="flow" aria-label="Traffic path">
      {flow.nodes.map((node, i) => (
        // Steps are keyed by position: when the gate changes (Mullvad ⇄ Residential)
        // the old node slides out while the new one drops into the same place.
        <li key={i} className={`flow-step${preview && previewSteps[preview].includes(node.id) ? ' is-affected' : ''}`}>
          {i > 0 ? (
            <FlowLink state={flow.links[i - 1]} rate={flow.rates[i - 1] || { down: 0, up: 0 }} scope={i <= 2 ? 'uplink' : flow.gateScope} requester="end" />
          ) : null}
          <AnimatedList
            swap
            items={[node]}
            getKey={(n) => n.id}
            render={(n) => (
              <Popover label={`${n.label} details`} align={i === 0 ? 'start' : i === last ? 'end' : 'center'} content={<FlowInfo node={n} state={state} />}>
                <span className={`flow-node tone-${n.state} scope-${n.scope}${n.active ? ' is-active' : ''}`}>
                  <span className="flow-icon"><n.icon aria-hidden /></span>
                  <span className="flow-text">
                    <span className="flow-label">{n.label}</span>
                    <span className="flow-detail">
                      <span className="sr-only">{n.state === 'ok' ? 'Working: ' : n.state === 'bad' ? 'Failing: ' : n.state === 'busy' ? 'Changing: ' : 'Idle: '}</span>
                      <SwapText>{n.detail}</SwapText>
                    </span>
                  </span>
                </span>
              </Popover>
            )}
          />
        </li>
      ))}
    </ol>
      <div className={`flow-under${!branch && branchPending ? ' is-reserving' : ''}`} style={piX ? ({ '--pi-x': `${piX}px` } as React.CSSProperties) : undefined}>
        {branch && piX ? <Spur branch={branch} /> : null}
        <dl className="flow-rates" aria-label="Network throughput">
          <div className="flow-rate">
            <dt><ArrowDown aria-hidden />In</dt>
            <dd><strong><AnimatedNumber value={net.down_bytes_per_sec || 0} format={fmtMbps} /></strong><small><AnimatedNumber value={net.down_bytes_per_sec || 0} format={fmtBytesRate} /></small></dd>
          </div>
          <div className="flow-rate">
            <dt><ArrowUp aria-hidden />Out</dt>
            <dd><strong><AnimatedNumber value={net.up_bytes_per_sec || 0} format={fmtMbps} /></strong><small><AnimatedNumber value={net.up_bytes_per_sec || 0} format={fmtBytesRate} /></small></dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
