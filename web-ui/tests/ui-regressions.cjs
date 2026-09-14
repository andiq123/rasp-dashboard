// Run with: node web-ui/tests/ui-regressions.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { QueryClient } = require('@tanstack/react-query')

// Compile the real TS/TSX modules with the existing compiler; no test dependency.
function load(file, extra = '') {
  const filename = path.resolve(__dirname, '../src', file)
  const source = fs.readFileSync(filename, 'utf8') + extra
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  })
  const module = { exports: {} }
  const resolve = (name) => name.startsWith('@/')
    ? load(`${name.slice(2)}.ts`)
    : require(name)
  new Function('require', 'module', 'exports', outputText)(resolve, module, module.exports)
  return module.exports
}

const { queryKeys } = load('api/queryKeys.ts')
const { applyStatsSnapshot } = load('hooks/realtime.tsx', '\nexport { applyStatsSnapshot }')
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

const { Field, Input } = load('components/ui/Field/Field.tsx')
const markup = renderToStaticMarkup(React.createElement(Field, { label: 'SSID', tip: 'Network name' }, React.createElement(Input)))
const labelId = markup.match(/for="([^"]+)"/)[1]
assert.ok(markup.includes(`id="${labelId}"`), 'Generated label must target the control')
assert.ok(markup.includes(`aria-describedby="${labelId}-tip"`), 'Help text must be associated with the control')
client.clear()
console.log('UI regressions passed: batched live stats, cache preservation, accessible fields.')
