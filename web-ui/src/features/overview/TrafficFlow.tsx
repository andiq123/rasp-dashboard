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

/**
 * One hop with two packet streams: solid packets carry data in, toward whoever
 * asked; hollow rings carry requests out, toward the internet. Each stream moves
 * at the speed of its own direction and fades out when it goes quiet.
 */
function FlowLink({ state, rate, requester = 'right' }: { state: LinkState; rate: LinkRate; requester?: 'left' | 'right' }) {
  const dots = (n: number) => Array.from({ length: n }, (_, k) => <i key={k} className="flow-packet" />)
  if (state !== 'flow') {
    return (
      <span className={`flow-link is-${state} ${linkTone[state]}`} aria-hidden title={linkLabel[state]}>
        <span className="flow-packets">{dots(2)}</span>
        {state === 'blocked' ? <Ban className="flow-barrier" /> : null}
      </span>
    )
  }
  const inLevel = trafficLevel(rate.down)
  const outLevel = trafficLevel(rate.up)
  const level = Math.max(inLevel, outLevel)
  const title = level === 0 ? 'connected, idle' : `in ${fmtRate(rate.down)}, out ${fmtRate(rate.up)}`
  return (
    <span className={`flow-link is-flow tone-ok level-${level}`} aria-hidden title={title}>
      <span className={`flow-packets is-in level-${inLevel}${requester === 'left' ? ' rev' : ''}`} style={{ '--flow-dur': levelDuration[inLevel] } as React.CSSProperties}>
        {dots(levelPackets[inLevel])}
      </span>
      <span className={`flow-packets is-out level-${outLevel}${requester === 'right' ? ' rev' : ''}`} style={{ '--flow-dur': levelDuration[outLevel] } as React.CSSProperties}>
        {dots(levelPackets[outLevel])}
      </span>
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

const BRANCH_MIN_WIDTH = 228

/**
 * Loop under the main path: from the Pi down to Your apps and Public links,
 * then back up into the first Internet node. These leave over Ethernet and
 * skip the VPN; requests travel left toward the internet, responses come back.
 */
function Branch({ branch, from, to, compact }: { branch: FlowBranch; from: number; to: number; compact: boolean }) {
  const appRate = branch.appUse.reduce<LinkRate>((r, u) => ({ down: r.down + u.in, up: r.up + u.out }), { down: 0, up: 0 })
  const outRate: LinkRate = { down: appRate.down + branch.linkUse.down, up: appRate.up + branch.linkUse.up }
  const apps: FlowNode = {
    id: 'apps', label: 'Your apps', icon: Package,
    detail: branch.apps === 1 ? '1 running' : `${branch.apps} running`,
    state: branch.apps ? 'ok' : 'idle',
    active: appRate.down + appRate.up >= ACTIVE_BPS,
  }
  const links: FlowNode = {
    id: 'links', label: 'Public links', icon: Cloud,
    detail: branch.links ? `${branch.liveLinks} of ${branch.links} live` : 'None',
    state: !branch.links ? 'idle' : branch.liveLinks === branch.links ? 'ok' : 'bad',
  }
  const carry = branch.internet && branch.apps > 0
  return (
    <div
      className={`flow-branch${compact ? ' is-compact' : ''}`}
      style={{ '--branch-from': `${from}px`, '--branch-to': `${to}px` } as React.CSSProperties}
      aria-label="Apps and public links reach the internet directly, skipping the VPN"
    >
      {compact ? <span className="branch-from">Apps, no VPN</span> : <span className="branch-elbow is-up tone-ok" aria-hidden title="Back to the internet, no VPN" />}
      <FlowLink state={branch.internet ? 'flow' : 'blocked'} rate={outRate} requester="right" />
      <NodeView
        node={links}
        info={
          <BranchInfo title="Public links" line="Cloudflare tunnels publish your apps on the web and are routed around the VPN.">
            <p className="pop-line">About ↓ {fmtRate(branch.linkUse.down)} visitors in, ↑ {fmtRate(branch.linkUse.up)} responses out (estimated from Ethernet traffic).</p>
          </BranchInfo>
        }
      />
      <FlowLink state={carry && branch.links ? 'flow' : 'idle'} rate={branch.linkUse} requester="right" />
      <NodeView
        node={apps}
        info={
          <BranchInfo title="Your apps" line="Apps reach the internet over Ethernet directly. Using the internet right now:">
            <UseList items={branch.appUse} empty="No app is using the internet right now." />
          </BranchInfo>
        }
      />
      <FlowLink state={carry ? 'flow' : 'idle'} rate={appRate} requester="right" />
      {compact ? null : <span className="branch-elbow is-down tone-ok" aria-hidden />}
    </div>
  )
}

/** Animated diagram of where traffic flows and where it stops. Every step opens an info popup. */
export function TrafficFlow({ flow, state, branch }: { flow: Flow; state: AppState; branch?: FlowBranch }) {
  const last = flow.nodes.length - 1
  const wrap = useRef<HTMLDivElement>(null)
  const [span, setSpan] = useState<{ from: number; to: number }>({ from: 0, to: 0 })
  const hasBranch = !!branch
  // Start the branch exactly under the Pi icon, wherever the layout puts it.
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el || !hasBranch) return
    // The loop spans from under the Internet icon to under the Pi icon.
    const measure = () => {
      const internet = el.querySelector<HTMLElement>('.flow > .flow-step:nth-child(1) .flow-icon')
      const pi = el.querySelector<HTMLElement>('.flow > .flow-step:nth-child(3) .flow-icon')
      if (!internet || !pi) return
      const a = el.getBoundingClientRect().left
      const center = (n: HTMLElement) => {
        const r = n.getBoundingClientRect()
        return Math.round(r.left + r.width / 2 - a)
      }
      const next = { from: center(internet), to: center(pi) }
      setSpan((prev) => (prev.from === next.from && prev.to === next.to ? prev : next))
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
            <FlowLink state={flow.links[i - 1]} rate={flow.rates[i - 1] || { down: 0, up: 0 }} />
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
      {/* A loop back to Internet when there is room; otherwise a compact row. */}
      {branch && span.to ? <Branch branch={branch} from={span.from} to={span.to} compact={span.to - span.from < BRANCH_MIN_WIDTH} /> : null}
      <div className="flow-legend" aria-hidden>
        <span><i className="legend-in" />Data coming in</span>
        <span><i className="legend-out" />Requests going out</span>
      </div>
    </div>
  )
}
