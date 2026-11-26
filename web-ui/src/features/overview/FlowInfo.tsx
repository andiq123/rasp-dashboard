import { Signal, SignalHigh, SignalLow, SignalMedium, SignalZero } from 'lucide-react'
import type { AppState, ConnectedDevice } from '@/api/types'
import { KeyValues, type KeyValue } from '@/components/ui/KeyValues/KeyValues'
import { deviceKind, fmtDuration, signalBars } from '@/lib/devices'
import { daysLeftText, daysLeftTone, expiryDate } from '@/lib/mullvad'
import { fmtBytes, fmtPct, fmtRate } from '@/lib/format'
import type { FlowNode } from './TrafficFlow'

const stateWord: Record<FlowNode['state'], string> = { ok: 'Working', bad: 'Failing', busy: 'Changing', idle: 'Idle' }
const signalIcon = [SignalZero, SignalLow, SignalMedium, SignalHigh, Signal]

function DeviceRow({ device }: { device: ConnectedDevice }) {
  const kind = deviceKind(device.name)
  const bars = signalBars(device.signal_dbm)
  const Bars = signalIcon[bars]
  return (
    <li className="device-row">
      <span className="device-icon" title={kind.label}><kind.icon aria-hidden /></span>
      <span className="device-text">
        <strong>{device.name || 'Unnamed device'}</strong>
        <small>
          <span>{device.ip || device.mac}</span>
          <span>{fmtDuration(device.connected_seconds)}</span>
          <span>{fmtBytes((device.rx_bytes || 0) + (device.tx_bytes || 0))}</span>
        </small>
      </span>
      <span className={`device-signal bars-${bars}`} title={device.signal_dbm ? `${device.signal_dbm} dBm` : 'Signal unknown'}>
        <Bars aria-hidden />
        <span className="sr-only">{bars} of 4 signal bars</span>
      </span>
    </li>
  )
}

/** What a flow step is doing right now, in plain words plus the facts behind it. */
export function FlowInfo({ node, state }: { node: FlowNode; state: AppState }) {
  const vpn = state.vpn_health || {}
  const uplink = state.uplink || {}
  const m = state.device_metrics || {}
  let line = ''
  let rows: KeyValue[] = []

  switch (node.id) {
    case 'internet':
      line = node.state === 'ok' ? 'The Pi reaches the internet over its Ethernet uplink.' : 'The Pi cannot reach 1.1.1.1 or 8.8.8.8 over Ethernet.'
      rows = [{ label: 'Checked over', value: uplink.interface || 'eth0' }, { label: 'Traffic now', value: fmtRate(state.traffic?.uplink_bps) }, { label: 'Check', value: 'TCP 443, every 30s' }]
      break
    case 'uplink':
      line = uplink.link_up ? 'The cable to your router is connected.' : 'No cable link. Check the Ethernet cable and router.'
      rows = [
        { label: 'Interface', value: uplink.interface || 'eth0' },
        { label: 'Link', value: uplink.link_up ? 'Up' : 'Down', tone: uplink.link_up ? 'ok' : 'bad' },
        { label: 'Internet', value: uplink.internet ? 'Reachable' : 'Unreachable', tone: uplink.internet ? 'ok' : 'bad' },
        { label: 'Traffic now', value: fmtRate(state.traffic?.uplink_bps) },
      ]
      break
    case 'pi':
      line = 'Routes Wi‑Fi traffic and enforces the exit rule.'
      rows = [
        { label: 'Hotspot address', value: state.hotspot_ip || '—' },
        { label: 'CPU', value: fmtPct(m.cpu?.busy_percent) },
        { label: 'Memory', value: fmtPct(m.memory?.used_percent) },
        { label: 'Temperature', value: m.thermal?.available ? `${Number(m.thermal.temperature_celsius || 0).toFixed(0)}°C` : '—' },
      ]
      {
        // The Pi's own processes using the internet (updates, tools), busiest first.
        const busy = (state.net_users || []).filter((u) => u.kind === 'pi' && u.rate_bps > 0).slice(0, 3)
        rows.push({ label: 'Using internet', value: busy.length ? busy.map((u) => `${u.name} ${fmtRate(u.rate_bps)}`).join(', ') : 'Nothing right now' })
      }
      break
    case 'mullvad':
      line = node.state === 'ok' ? 'Wi‑Fi traffic is encrypted to Mullvad and exits in Romania.'
        : node.state === 'busy' ? 'Applying the change. Traffic resumes once the exit is verified.'
          : 'Wi‑Fi traffic is held here until a Romanian Mullvad exit is verified.'
      rows = [
        { label: 'Relay', value: vpn.relay || 'Unknown' },
        { label: 'Tunnel traffic', value: fmtRate(state.traffic?.tunnel_bps) },
        { label: 'Endpoint', value: vpn.endpoint || '—' },
        { label: 'Handshake', value: vpn.handshake_healthy ? `${Number(vpn.handshake_age_seconds || 0)}s ago` : 'None', tone: vpn.handshake_healthy ? undefined : 'bad' },
        { label: 'Exit check', value: vpn.egress_ok ? 'Romania verified' : 'Not verified', tone: vpn.egress_ok ? 'ok' : 'bad' },
        ...(state.mullvad_account?.configured
          ? [{ label: 'Time left', value: `${daysLeftText(state.mullvad_account)}, until ${expiryDate(state.mullvad_account)}`, tone: daysLeftTone(state.mullvad_account) === 'ok' ? undefined : daysLeftTone(state.mullvad_account) }]
          : []),
      ]
      break
    case 'residential':
      line = node.state === 'ok' ? 'Wi‑Fi web traffic goes out through the IPRoyal residential proxy.'
        : node.state === 'busy' ? 'Applying the change. Traffic resumes once the proxy is running.'
          : 'The proxy is stopped, so Wi‑Fi traffic is held here.'
      rows = [{ label: 'Proxy', value: state.proxy_running ? 'Running' : 'Stopped', tone: state.proxy_running ? 'ok' : 'bad' }]
      break
    case 'wifi':
      line = state.hotspot_running ? `Broadcasting ${state.ssid || 'the hotspot'} for your devices.` : 'The hotspot is stopped.'
      rows = [
        { label: 'Network', value: state.ssid || '—' },
        { label: 'Wi‑Fi traffic', value: fmtRate(state.traffic?.hotspot_bps) },
      ]
      break
    case 'devices': {
      const devices = state.devices || []
      return (
        <div className="pop-body">
          <div className="pop-head">
            <strong>Devices</strong>
            <span className={`pop-state tone-${node.state}`}>{devices.length ? `${devices.length} connected` : 'None'}</span>
          </div>
          {devices.length ? (
            <ul className="device-list">{devices.map((d) => <DeviceRow key={d.mac} device={d} />)}</ul>
          ) : (
            <p className="pop-line">{state.hotspot_running ? `No devices are connected to ${state.ssid || 'the hotspot'} yet.` : 'Start the hotspot to let devices connect.'}</p>
          )}
        </div>
      )
    }
  }

  return (
    <div className="pop-body">
      <div className="pop-head">
        <strong>{node.label}</strong>
        <span className={`pop-state tone-${node.state}`}>{stateWord[node.state]}</span>
      </div>
      <p className="pop-line">{line}</p>
      {rows.length ? <KeyValues items={rows} /> : null}
    </div>
  )
}
