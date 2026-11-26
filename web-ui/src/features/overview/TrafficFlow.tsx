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

export type FlowNode = { id: string; label: string; detail: string; state: NodeState; icon: LucideIcon }
export type Flow = { nodes: FlowNode[]; links: LinkState[]; rates: number[] }

/** Traffic level 0–3 from bytes/s, on a log scale (idle, light, busy, heavy). */
export function trafficLevel(bps: number): 0 | 1 | 2 | 3 {
  if (bps >= 800_000) return 3
  if (bps >= 60_000) return 2
  if (bps >= 2_000) return 1
  return 0
}

const levelDuration = ['2.8s', '1.9s', '1.2s', '0.75s']
const levelPackets = [1, 2, 3, 3]

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
  // Each link animates at the speed of the interface that carries it.
  const t = state.traffic || {}
  const uplinkRate = t.uplink_bps || 0
  const tunnelRate = mode === 'mullvad' ? t.tunnel_bps || 0 : t.hotspot_bps || 0
  const hotspotRate = t.hotspot_bps || 0
  return { nodes, links, rates: [uplinkRate, uplinkRate, tunnelRate, tunnelRate, hotspotRate] }
}

const linkTone: Record<LinkState, string> = { flow: 'tone-ok', blocked: 'tone-bad', busy: 'tone-busy', idle: 'tone-idle' }
const linkLabel: Record<LinkState, string> = { flow: 'traffic flowing', blocked: 'traffic blocked', busy: 'being repaired', idle: 'no traffic' }

/** One hop: packets move at a speed and density that follow its live traffic. */
function FlowLink({ state, bps }: { state: LinkState; bps: number }) {
  const level = state === 'flow' ? trafficLevel(bps) : 1
  const title = state !== 'flow' ? linkLabel[state] : level === 0 ? `connected, idle (${fmtRate(bps)})` : `${linkLabel.flow}, ${fmtRate(bps)}`
  return (
    <span
      className={`flow-link is-${state} ${linkTone[state]} level-${level}`}
      style={{ '--flow-dur': levelDuration[level] } as React.CSSProperties}
      aria-hidden
      title={title}
    >
      {Array.from({ length: state === 'flow' ? levelPackets[level] : 2 }, (_, k) => <i key={k} className="flow-packet" />)}
      {state === 'blocked' ? <Ban className="flow-barrier" /> : null}
    </span>
  )
}

/** Apps and their public links, which leave over Ethernet and skip the VPN. */
export type FlowBranch = { apps: number; links: number; liveLinks: number; bps: number; internet: boolean }

function NodeView({ node, info }: { node: FlowNode; info: React.ReactNode }) {
  return (
    <Popover label={`${node.label} details`} align="center" content={info}>
      <span className={`flow-node tone-${node.state}`}>
        <span className="flow-icon"><node.icon aria-hidden /></span>
        <span className="flow-text">
          <span className="flow-label">{node.label}</span>
          <span className="flow-detail"><SwapText>{node.detail}</SwapText></span>
        </span>
      </span>
    </Popover>
  )
}

function BranchInfo({ title, line }: { title: string; line: string }) {
  return (
    <div className="pop-body">
      <div className="pop-head"><strong>{title}</strong><span className="pop-state tone-ok">Skips the VPN</span></div>
      <p className="pop-line">{line}</p>
    </div>
  )
}

/** Branch under the Pi: apps → public links → internet, directly over Ethernet. */
function Branch({ branch, x }: { branch: FlowBranch; x: number }) {
  const apps: FlowNode = { id: 'apps', label: 'Your apps', icon: Package, detail: branch.apps === 1 ? '1 running' : `${branch.apps} running`, state: branch.apps ? 'ok' : 'idle' }
  const links: FlowNode = {
    id: 'links', label: 'Public links', icon: Cloud,
    detail: branch.links ? `${branch.liveLinks} of ${branch.links} live` : 'None',
    state: !branch.links ? 'idle' : branch.liveLinks === branch.links ? 'ok' : 'bad',
  }
  const net: FlowNode = { id: 'direct', label: 'Internet', icon: Globe, detail: 'Direct, no VPN', state: branch.internet ? 'ok' : 'bad' }
  const carry = branch.internet && branch.apps > 0
  return (
    <div className="flow-branch" style={{ '--branch-x': `${x}px` } as React.CSSProperties} aria-label="Apps and public links skip the VPN">
      <span className="branch-elbow tone-ok" aria-hidden />
      <FlowLink state={carry ? 'flow' : 'idle'} bps={branch.bps} />
      <NodeView node={apps} info={<BranchInfo title="Your apps" line="Deployed apps run on the Pi as their own user and reach the internet over Ethernet directly, so they never depend on the Mullvad tunnel." />} />
      <FlowLink state={carry && branch.links ? 'flow' : 'idle'} bps={branch.bps} />
      <NodeView node={links} info={<BranchInfo title="Public links" line="Cloudflare tunnels publish your apps on the web. Their traffic is routed around the VPN so links stay up even while the tunnel is repairing." />} />
      <FlowLink state={branch.internet ? 'flow' : 'blocked'} bps={branch.bps} />
      <NodeView node={net} info={<BranchInfo title="Direct internet" line="This path uses the Ethernet uplink only. Wi‑Fi devices still go through Mullvad in Romania." />} />
    </div>
  )
}

/** Animated diagram of where traffic flows and where it stops. Every step opens an info popup. */
export function TrafficFlow({ flow, state, branch }: { flow: Flow; state: AppState; branch?: FlowBranch }) {
  const last = flow.nodes.length - 1
  const wrap = useRef<HTMLDivElement>(null)
  const [piX, setPiX] = useState(0)
  const hasBranch = !!branch
  // Start the branch exactly under the Pi icon, wherever the layout puts it.
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el || !hasBranch) return
    const measure = () => {
      const icon = el.querySelector<HTMLElement>('.flow > .flow-step:nth-child(3) .flow-icon')
      if (!icon) return
      const a = el.getBoundingClientRect()
      const b = icon.getBoundingClientRect()
      setPiX(Math.round(b.left + b.width / 2 - a.left))
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
            <FlowLink state={flow.links[i - 1]} bps={flow.rates[i - 1] || 0} />
          ) : null}
          <AnimatedList
            swap
            items={[node]}
            getKey={(n) => n.id}
            render={(n) => (
              <Popover label={`${n.label} details`} align={i === 0 ? 'start' : i === last ? 'end' : 'center'} content={<FlowInfo node={n} state={state} />}>
                <span className={`flow-node tone-${n.state}`}>
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
      {branch && piX ? <Branch branch={branch} x={piX} /> : null}
    </div>
  )
}
