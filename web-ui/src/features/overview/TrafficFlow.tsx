import { useLayoutEffect, useRef, useState } from 'react'
import { Ban, Cable, Cloud, Cpu, Globe, Package, ShieldCheck, Smartphone, Waypoints, Wifi, type LucideIcon } from 'lucide-react'
import type { AppState } from '@/api/types'
import { AnimatedList } from '@/components/ui/AnimatedList/AnimatedList'
import { Popover } from '@/components/ui/Popover/Popover'
import { SwapText } from '@/components/ui/SwapText/SwapText'
import { FlowInfo } from './FlowInfo'

export type NodeState = 'ok' | 'bad' | 'busy' | 'idle'
/** flow: traffic moving · blocked: stopped at the next hop · busy: being repaired · idle: nothing to carry */
export type LinkState = 'flow' | 'blocked' | 'busy' | 'idle'

export type FlowNode = { id: string; label: string; detail: string; state: NodeState; icon: LucideIcon; active?: boolean }

/** Above this rate a node counts as actively requesting data. */
export const ACTIVE_BPS = 4_000
/** Live rate on one link: `down` travels to whoever asked, `up` toward the internet. */
export type LinkRate = { down: number; up: number }
export type Flow = { nodes: FlowNode[]; links: LinkState[]; rates: LinkRate[] }

/** Traffic level 0–3 from bytes/s, on a log scale (idle, light, busy, heavy). */
export function trafficLevel(bps: number): 0 | 1 | 2 | 3 {
  if (bps >= 1_000_000) return 3
  if (bps >= 100_000) return 2
  if (bps >= ACTIVE_BPS) return 1
  return 0
}

// Calm and honest: everyday traffic (a few KB/s) drifts slowly; only real
// downloads look fast.
const levelDuration = ['3.4s', '3.4s', '2.1s', '1.2s']
// Idle links look still: their packets stay mounted but faded out, so traffic
// starting or stopping cross-fades instead of popping.
const levelPackets = [2, 2, 3, 3]

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

  const gateOk = mode === 'mullvad'
    ? !!(vpn.country_allowed && vpn.interface_up && vpn.handshake_healthy && vpn.egress_ok)
    : !!state.proxy_running

  const nodes: FlowNode[] = [
    {
      id: 'internet', label: 'Internet', icon: Globe,
      detail: !uplinkKnown ? 'Checking…' : uplink?.internet ? 'Reachable' : 'Unreachable',
      state: !uplinkKnown ? 'idle' : uplink?.internet ? 'ok' : 'bad',
    },
    {
      id: 'uplink', label: 'Ethernet in', icon: Cable,
      detail: !known ? 'Checking…' : uplink?.link_up ? uplink.interface || 'eth0' : 'No link',
      state: !known ? 'idle' : uplink?.link_up ? 'ok' : 'bad',
    },
    { id: 'pi', label: 'Pi', icon: Cpu, detail: state.hotspot_ip || 'This device', state: known ? 'ok' : 'idle' },
    mode === 'mullvad'
      ? {
          id: 'mullvad', label: 'Mullvad', icon: ShieldCheck,
          detail: switching ? 'Switching' : recovering ? 'Repairing' : gateOk ? vpn.relay || 'Romania' : !vpn.country_allowed ? 'Not Romania' : vpn.interface_up ? 'Not verified' : 'Tunnel down',
          state: !known ? 'idle' : switching || recovering ? 'busy' : gateOk ? 'ok' : 'bad',
        }
      : {
          id: 'residential', label: 'Residential', icon: Waypoints,
          detail: switching ? 'Switching' : gateOk ? 'Running' : 'Stopped',
          state: !known ? 'idle' : switching ? 'busy' : gateOk ? 'ok' : 'bad',
        },
    {
      id: 'wifi', label: 'Wi‑Fi out', icon: Wifi,
      detail: state.hotspot_running ? state.ssid || 'Broadcasting' : 'Stopped',
      state: !known ? 'idle' : state.hotspot_running ? 'ok' : 'bad',
    },
    {
      id: 'devices', label: 'Devices', icon: Smartphone,
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
  return { nodes, links, rates: [uplinkLink, uplinkLink, gateLink, hotspotLink, hotspotLink] }
}

const linkTone: Record<LinkState, string> = { flow: 'tone-ok', blocked: 'tone-bad', busy: 'tone-busy', idle: 'tone-idle' }
const linkLabel: Record<LinkState, string> = { flow: 'traffic flowing', blocked: 'traffic blocked', busy: 'being repaired', idle: 'no traffic' }

/** One lane of a link: a line with an arrowhead and LED-like packets moving its way. */
function Lane({ dir, bps, toward }: { dir: 'in' | 'out'; bps: number; toward: 'start' | 'end' }) {
  const level = trafficLevel(bps)
  return (
    <span className={`lane is-${dir} to-${toward} level-${level}`} style={{ '--flow-dur': levelDuration[level] } as React.CSSProperties}>
      <span className="flow-packets">
        {Array.from({ length: levelPackets[level] }, (_, k) => <i key={k} className="flow-packet" />)}
      </span>
    </span>
  )
}

/**
 * A link drawn as a two-lane road. The top lane carries data in toward whoever
 * asked; the bottom lane carries requests out toward the internet. Each lane
 * moves at its own live speed and stays still when quiet.
 */
function FlowLink({ state, rate, requester = 'end', vertical = false }: { state: LinkState; rate: LinkRate; requester?: 'start' | 'end'; vertical?: boolean }) {
  const away = requester === 'end' ? 'start' : 'end'
  if (state !== 'flow') {
    return (
      <span className={`flow-link is-${state} ${linkTone[state]}${vertical ? ' is-vertical' : ''}`} aria-hidden title={linkLabel[state]}>
        <span className="flow-packets">{[0, 1].map((k) => <i key={k} className="flow-packet" />)}</span>
        {state === 'blocked' ? <Ban className="flow-barrier" /> : null}
      </span>
    )
  }
  const level = Math.max(trafficLevel(rate.down), trafficLevel(rate.up))
  const title = level === 0 ? 'connected, idle' : `in ${fmtRate(rate.down)}, out ${fmtRate(rate.up)}`
  return (
    <span className={`flow-link is-flow is-road tone-ok level-${level}${vertical ? ' is-vertical' : ''}`} aria-hidden title={title}>
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
      <span className={`flow-node tone-${node.state}${node.active ? ' is-active' : ''}`}>
        <span className="flow-icon"><node.icon aria-hidden /></span>
        <span className="flow-text">
          <span className="flow-label">{node.label}</span>
          <span className="flow-detail"><SwapText>{node.detail}</SwapText></span>
        </span>
      </span>
    </Popover>
  )
}

function UseList({ items, empty }: { items: NetUse[]; empty: string }) {
  if (!items.length) return <p className="pop-line">{empty}</p>
  return (
    <ul className="use-list">
      {items.slice(0, 5).map((u) => (
        <li key={u.name}>
          <span className="use-name">{u.name}</span>
          <span className="use-rate" title="Data coming in">↓ {fmtRate(u.in)}</span>
          <span className="use-rate is-out" title="Requests going out">↑ {fmtRate(u.out)}</span>
          <span className="use-conn">{u.connections === 1 ? '1 connection' : `${u.connections} connections`}</span>
        </li>
      ))}
    </ul>
  )
}

function BranchInfo({ title, line, children }: { title: string; line: string; children?: React.ReactNode }) {
  return (
    <div className="pop-body">
      <div className="pop-head"><strong>{title}</strong><span className="pop-state tone-ok">Skips the VPN</span></div>
      <p className="pop-line">{line}</p>
      {children}
    </div>
  )
}

/**
 * Spur under the Pi: deployed apps run on the Pi itself. Their internet traffic
 * (and visitors arriving through public links via cloudflared) goes back
 * through the Pi and out over Ethernet, never through the VPN.
 */
function Spur({ branch, x }: { branch: FlowBranch; x: number }) {
  const appRate = branch.appUse.reduce<LinkRate>((r, u) => ({ down: r.down + u.in, up: r.up + u.out }), { down: 0, up: 0 })
  const rate: LinkRate = { down: appRate.down + branch.linkUse.down, up: appRate.up + branch.linkUse.up }
  const apps: FlowNode = {
    id: 'apps', label: 'Your apps', icon: Package,
    detail: branch.apps === 1 ? '1 running' : `${branch.apps} running`,
    state: branch.apps ? 'ok' : 'idle',
    active: rate.down + rate.up >= ACTIVE_BPS,
  }
  const linksOk = !branch.links || branch.liveLinks === branch.links
  return (
    <div className="flow-spur" style={{ '--pi-x': `${x}px` } as React.CSSProperties} aria-label="Apps on the Pi use Ethernet directly, not the VPN">
      <FlowLink state={branch.internet && branch.apps ? 'flow' : 'idle'} rate={rate} requester="end" vertical />
      <NodeView
        node={apps}
        info={
          <BranchInfo title="Your apps" line="Apps run on the Pi. Their traffic, and visitors coming in through public links, goes through the Pi and out over Ethernet, not the VPN.">
            <UseList items={branch.appUse} empty="No app is using the internet right now." />
            {branch.links ? (
              <p className="pop-line">
                Public links: {branch.liveLinks} of {branch.links} live, about ↓ {fmtRate(branch.linkUse.down)} in, ↑ {fmtRate(branch.linkUse.up)} out (estimated).
              </p>
            ) : null}
          </BranchInfo>
        }
      />
      <span className="spur-tags">
        {branch.links ? (
          <span className={`spur-tag${linksOk ? '' : ' is-bad'}`}><Cloud aria-hidden />{branch.liveLinks}/{branch.links} public links</span>
        ) : null}
        <span className="spur-tag">Direct, no VPN</span>
      </span>
    </div>
  )
}

/** Animated diagram of where traffic flows and where it stops. Every step opens an info popup. */
export function TrafficFlow({ flow, state, branch }: { flow: Flow; state: AppState; branch?: FlowBranch }) {
  const last = flow.nodes.length - 1
  const wrap = useRef<HTMLDivElement>(null)
  const [piX, setPiX] = useState(0)
  const hasBranch = !!branch
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el || !hasBranch) return
    // The spur hangs from the Pi icon, wherever the layout puts it.
    const measure = () => {
      const pi = el.querySelector<HTMLElement>('.flow > .flow-step:nth-child(3) .flow-icon')
      if (!pi) return
      const r = pi.getBoundingClientRect()
      setPiX(Math.round(r.left + r.width / 2 - el.getBoundingClientRect().left))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasBranch])
  return (
    <div className="flow-wrap" ref={wrap}>
    <ol className="flow" aria-label="Traffic path">
      {flow.nodes.map((node, i) => (
        // Steps are keyed by position: when the gate changes (Mullvad ⇄ Residential)
        // the old node slides out while the new one drops into the same place.
        <li key={i} className="flow-step">
          {i > 0 ? (
            <FlowLink state={flow.links[i - 1]} rate={flow.rates[i - 1] || { down: 0, up: 0 }} requester="end" />
          ) : null}
          <AnimatedList
            swap
            items={[node]}
            getKey={(n) => n.id}
            render={(n) => (
              <Popover label={`${n.label} details`} align={i === 0 ? 'start' : i === last ? 'end' : 'center'} content={<FlowInfo node={n} state={state} />}>
                <span className={`flow-node tone-${n.state}${n.active ? ' is-active' : ''}`}>
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
      {branch && piX ? <Spur branch={branch} x={piX} /> : null}
      <div className="flow-legend" aria-hidden>
        <span><i className="legend-in" />Data coming in</span>
        <span><i className="legend-out" />Requests going out</span>
      </div>
    </div>
  )
}
