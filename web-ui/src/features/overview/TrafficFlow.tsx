import { Ban, Cable, Cpu, Globe, ShieldCheck, Smartphone, Waypoints, Wifi, type LucideIcon } from 'lucide-react'
import type { AppState } from '@/api/types'
import { SwapText } from '@/components/ui/SwapText/SwapText'

export type NodeState = 'ok' | 'bad' | 'busy' | 'idle'
/** flow: traffic moving · blocked: stopped at the next hop · busy: being repaired · idle: nothing to carry */
export type LinkState = 'flow' | 'blocked' | 'busy' | 'idle'

export type FlowNode = { id: string; label: string; detail: string; state: NodeState; icon: LucideIcon }
export type Flow = { nodes: FlowNode[]; links: LinkState[] }

/**
 * The path internet takes from the Pi's uplink to the devices on its Wi‑Fi.
 * A link carries traffic only while everything before it carries traffic, so
 * the diagram shows exactly where the flow stops.
 */
export function computeFlow(state: AppState, recovering: boolean): Flow {
  const mode = state.mode === 'residential' ? 'residential' : 'mullvad'
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
      detail: !known ? 'Checking…' : uplink?.link_up ? `${uplink.interface || 'eth0'} connected` : 'No link',
      state: !known ? 'idle' : uplink?.link_up ? 'ok' : 'bad',
    },
    { id: 'pi', label: 'Pi', icon: Cpu, detail: state.hotspot_ip || 'This device', state: known ? 'ok' : 'idle' },
    mode === 'mullvad'
      ? {
          id: 'gate', label: 'Mullvad', icon: ShieldCheck,
          detail: recovering ? 'Repairing tunnel' : gateOk ? `${vpn.relay || 'Romania'}` : !vpn.country_allowed ? 'Outside Romania' : vpn.interface_up ? 'Romania not verified' : 'Tunnel down',
          state: !known ? 'idle' : recovering ? 'busy' : gateOk ? 'ok' : 'bad',
        }
      : {
          id: 'gate', label: 'Residential', icon: Waypoints,
          detail: gateOk ? 'Proxy running' : 'Proxy stopped',
          state: !known ? 'idle' : gateOk ? 'ok' : 'bad',
        },
    {
      id: 'wifi', label: 'Wi‑Fi out', icon: Wifi,
      detail: state.hotspot_running ? state.ssid || 'Broadcasting' : 'Stopped',
      state: !known ? 'idle' : state.hotspot_running ? 'ok' : 'bad',
    },
    {
      id: 'devices', label: 'Devices', icon: Smartphone,
      detail: !state.hotspot_running ? 'Not connected' : clients === 1 ? '1 connected' : clients ? `${clients} connected` : 'None connected',
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
  return { nodes, links }
}

const linkTone: Record<LinkState, string> = { flow: 'tone-ok', blocked: 'tone-bad', busy: 'tone-busy', idle: 'tone-idle' }
const linkLabel: Record<LinkState, string> = { flow: 'traffic flowing', blocked: 'traffic blocked', busy: 'being repaired', idle: 'no traffic' }

/** Animated diagram of where traffic flows and where it stops. */
export function TrafficFlow({ flow }: { flow: Flow }) {
  return (
    <ol className="flow" aria-label="Traffic path">
      {flow.nodes.map((node, i) => (
        <li key={node.id} className="contents">
          {i > 0 ? (
            <span className={`flow-link is-${flow.links[i - 1]} ${linkTone[flow.links[i - 1]]}`} aria-hidden title={linkLabel[flow.links[i - 1]]}>
              <i className="flow-packet" />
              <i className="flow-packet" />
              <i className="flow-packet" />
              {flow.links[i - 1] === 'blocked' ? <Ban className="flow-barrier" /> : null}
            </span>
          ) : null}
          <div className={`flow-node tone-${node.state === 'busy' ? 'busy' : node.state}`}>
            <span className="flow-icon"><node.icon aria-hidden /></span>
            <span className="flow-text">
              <span className="flow-label">{node.label}</span>
              <span className="flow-detail">
                <span className="sr-only">{node.state === 'ok' ? 'Working: ' : node.state === 'bad' ? 'Failing: ' : node.state === 'busy' ? 'Repairing: ' : 'Idle: '}</span>
                <SwapText>{node.detail}</SwapText>
              </span>
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}
