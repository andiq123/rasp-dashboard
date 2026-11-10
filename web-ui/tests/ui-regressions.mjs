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
console.log('UI regressions passed: live stats, accessible fields, VPN failure stages, recovery, retry states, countdowns.')
} finally {
  await vite.close()
}
