// Run with: npm test (from web-ui)
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient } from '@tanstack/react-query'
import { createServer } from 'vite'

// Load the real TS/TSX modules through Vite's own transform; no test dependency.
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true },
})
const load = (file) => vite.ssrLoadModule(`/src/${file}`)

try {
const { queryKeys } = await load('api/queryKeys.ts')
const { applyStatsSnapshot } = await load('hooks/realtime.tsx')
const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
const services = Array.from({ length: 100 }, (_, i) => ({ slug: `app-${i}`, name: `Application ${i}` }))
client.setQueryData(queryKeys.services('demo'), services)
client.setQueryData(queryKeys.service('demo', 'app-0'), { ...services[0], env: 'preserve' })
const changes = []
client.getQueryCache().subscribe(event => {
  if (event.type === 'updated' && event.query.queryKey[0] === 'services') changes.push(event)
})
applyStatsSnapshot(client, { groups: { demo: { 'app-0': { cpu_percent: 12 }, 'app-99': { cpu_percent: 24 } } } })
const updated = client.getQueryData(queryKeys.services('demo'))
assert.equal(changes.length, 1, 'Each group list should update only once per snapshot')
assert.equal(updated.length, 100)
assert.equal(updated[0].stats.cpu_percent, 12)
assert.equal(updated[99].stats.cpu_percent, 24)
assert.equal(updated[50], services[50], 'Untouched service identity must be preserved')
assert.equal(client.getQueryData(queryKeys.service('demo', 'app-0')).env, 'preserve')
assert.equal(client.getQueryData(queryKeys.service('demo', 'app-99')), undefined, 'Do not create partial detail caches')
applyStatsSnapshot(client, {})
assert.equal(changes.length, 1, 'An empty snapshot must not clear existing data')

const { Field, Input } = await load('components/ui/Field/Field.tsx')
const markup = renderToStaticMarkup(React.createElement(Field, { label: 'SSID', tip: 'Network name' }, React.createElement(Input)))
const labelId = markup.match(/for="([^"]+)"/)[1]
assert.ok(markup.includes(`id="${labelId}"`), 'Generated label must target the control')
assert.ok(markup.includes(`aria-describedby="${labelId}-tip"`), 'Help text must be associated with the control')
client.clear()
const { VPNRepairFlow, retryLabel } = await load('features/overview/VPNRepairFlow.tsx')
const renderRepair = (repair, props = {}) => renderToStaticMarkup(React.createElement(VPNRepairFlow, { repair, healthy: false, onRetry() {}, ...props }))
const failed = { phase: 'failed', failed_phase: 'fetching', error: 'Relay download failed', next_retry_at: '2026-10-05T12:05:00Z', attempt: 2 }
const failedMarkup = renderRepair(failed)
assert.ok(failedMarkup.includes('Retry now'), 'A failed repair must offer a manual retry')
assert.ok(failedMarkup.includes('Relay list: failed'), 'Failure must mark the actual stage')
assert.ok(failedMarkup.includes('Restart: pending'), 'Failure before restart must not claim a completed restart')
assert.ok(!renderRepair({ ...failed, failed_phase: undefined }).includes('Restart: completed'), 'Older server failures must not invent completed stages')
const restoredMarkup = renderRepair(failed, { healthy: true })
assert.ok(restoredMarkup.includes('VPN connection restored'))
assert.ok(!restoredMarkup.includes('Relay download failed') && !restoredMarkup.includes('Retry now'), 'A recovered connection must not show stale failure or retry')
const recoveredMarkup = renderRepair({ phase: 'recovered', message: 'Connection recovered' }, { healthy: true })
assert.ok(recoveredMarkup.includes('VPN connection restored') && !recoveredMarkup.includes('completed'), 'Natural recovery must not claim repair stages completed')
const scheduledMarkup = renderRepair({ phase: 'scheduled', next_retry_at: failed.next_retry_at })
assert.ok(scheduledMarkup.includes('VPN repair scheduled') && scheduledMarkup.includes('Repair now'))
assert.ok(!scheduledMarkup.includes('animate-spin'), 'Scheduled repair is waiting, not running')
const pendingMarkup = renderRepair(failed, { loading: true })
assert.ok(/<button[^>]*disabled/.test(pendingMarkup), 'Retry must disable while submitting')
assert.equal(retryLabel(failed.next_retry_at, Date.parse('2026-10-05T12:04:01Z')), 'Automatic retry in 59s, if the connection is still unhealthy.')
assert.equal(retryLabel(failed.next_retry_at, Date.parse('2026-10-05T12:05:01Z')), 'Checking whether another retry is needed…')
assert.ok(!retryLabel('invalid', Date.now()).includes('NaN'))
const { computeFlow } = await load('features/overview/TrafficFlow.tsx')
const base = {
  generated_at: '2026-11-26T18:00:00Z', mode: 'mullvad', hotspot_running: true, ssid: 'FireWifi', clients: 2,
  uplink: { interface: 'eth0', link_up: true, internet: true, checked: true },
  vpn_health: { country_allowed: true, interface_up: true, handshake_healthy: true, egress_ok: true, relay: 'ro-buh-wg-012' },
}
const links = (state, recovering = false) => computeFlow(state, recovering).links.join(',')
assert.equal(links(base), 'flow,flow,flow,flow,flow', 'Healthy route flows end to end')
assert.equal(links({ ...base, vpn_health: { ...base.vpn_health, egress_ok: false } }), 'flow,flow,blocked,idle,idle', 'A failed tunnel holds traffic at the Mullvad gate while the Pi stays online')
assert.equal(links({ ...base, vpn_health: { ...base.vpn_health, egress_ok: false } }, true), 'flow,flow,busy,idle,idle', 'A running repair shows progress, not a break')
assert.equal(links({ ...base, uplink: { ...base.uplink, internet: false } }), 'idle,idle,idle,idle,idle', 'No uplink internet means nothing flows')
assert.equal(links({ ...base, hotspot_running: false }), 'flow,flow,flow,blocked,idle', 'A stopped hotspot stops traffic at the Wi-Fi output')
assert.equal(links({ ...base, clients: 0 }), 'flow,flow,flow,flow,idle', 'No connected devices: nothing to deliver')
assert.equal(links({ ...base, mode: 'residential', proxy_running: false }), 'flow,flow,blocked,idle,idle', 'Residential mode gates on the proxy')
assert.equal(links({ mode: 'mullvad', hotspot_running: false }), 'idle,idle,idle,idle,idle', 'Before the first state nothing claims to flow')
const busyPi = computeFlow({ ...base, traffic: { uplink_bps: 900_000, tunnel_bps: 850_000, hotspot_bps: 0 } }, false).rates
assert.deepEqual(busyPi, [900_000, 900_000, 850_000, 0, 0], 'Pi updates speed up Ethernet and the tunnel only; the Wi-Fi side follows Wi-Fi traffic')
const activeIds = (traffic) => computeFlow({ ...base, traffic }, false).nodes.filter((n) => n.active).map((n) => n.id).join(',')
assert.equal(activeIds({ uplink_bps: 900_000, tunnel_bps: 850_000, hotspot_bps: 0 }), 'pi', 'The Pi is highlighted when it is the one downloading')
assert.equal(activeIds({ uplink_bps: 600_000, tunnel_bps: 550_000, hotspot_bps: 540_000 }), 'devices', 'Devices are highlighted when Wi-Fi traffic explains the tunnel traffic')
assert.equal(activeIds({ uplink_bps: 500, tunnel_bps: 300, hotspot_bps: 0 }), '', 'Nothing is highlighted while idle')
const { appsAt, findSpikes, summarizeApps } = await load('lib/appHistory.ts')
const appA = { group: 'g', slug: 'a', name: 'api', type: 'go', points: [{ at: 100, cpu_percent: 80, memory_mb: 50 }, { at: 130, cpu_percent: 10, memory_mb: 40 }] }
const appB = { group: 'g', slug: 'b', name: 'db', type: 'postgres', points: [{ at: 100, cpu_percent: 20, memory_mb: 200 }, { at: 130, cpu_percent: 40, memory_mb: 210 }] }
const at100 = appsAt([appB, appA], 101, 4, 45)
assert.equal(at100[0].app.name, 'api', 'Busiest app at a moment comes first')
assert.equal(at100[0].cpu, 20, 'App CPU is scaled to the whole Pi (80% of a core on 4 cores = 20%)')
assert.equal(appsAt([appA], 1000, 4, 45).length, 0, 'Samples far from the moment are ignored')
assert.equal(summarizeApps([appA, appB], 4)[0].app.name, 'api', 'Range ranking uses average CPU (api 45% vs db 30% of a core)')
const flat = Array.from({ length: 40 }, (_, i) => ({ at: i * 30, cpu_percent: i === 25 ? 90 : 5 }))
assert.deepEqual(findSpikes(flat), [25], 'A standout CPU peak is detected')
assert.deepEqual(findSpikes(flat.map((p) => ({ ...p, cpu_percent: 5 }))), [], 'A flat line has no spikes')
console.log('UI regressions passed: live stats, accessible fields, VPN failure stages, recovery, retry states, countdowns, traffic flow scenarios, spike attribution.')
} finally {
  await vite.close()
}
