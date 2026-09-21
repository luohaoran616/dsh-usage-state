import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProviderRows, reorderProviders, setProviderMode } from '../../src/client/provider-rows.ts'
import { DEFAULT_CONFIG, normalizeConfig, type UsageStateConfig } from '../../src/shared/config.ts'
import type { SourceCatalog } from '../../src/shared/display.ts'

const CATALOG: SourceCatalog = [
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    modes: ['api'],
    requiresBaseUrl: false,
    defaultBaseUrl: { api: 'https://api.deepseek.com' },
    credentialRefs: { api: ['DEEPSEEK_API_KEY'] },
  },
  {
    id: 'zai',
    displayName: 'z.ai / GLM',
    modes: ['coding-plan'],
    requiresBaseUrl: false,
    defaultBaseUrl: { 'coding-plan': 'https://api.z.ai' },
    credentialRefs: { 'coding-plan': ['ZAI_API_KEY'] },
  },
  {
    id: 'sub2api',
    displayName: 'Sub2API',
    modes: ['api', 'coding-plan'],
    requiresBaseUrl: true,
    defaultBaseUrl: {},
    credentialRefs: { api: ['SUB2API_API_KEY'], 'coding-plan': ['SUB2API_API_KEY'] },
  },
]

const MODELS = [
  { provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-flash', name: 'DeepSeek V4 Flash' },
  { provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { provider: 'zai', providerName: 'z.ai / GLM', model: 'glm-4.6', name: 'GLM-4.6' },
]

function configWith(patch: Partial<UsageStateConfig>): UsageStateConfig {
  return normalizeConfig({ ...DEFAULT_CONFIG, ...patch })
}

test('models are grouped into one row per provider', () => {
  const rows = buildProviderRows({ models: MODELS, config: DEFAULT_CONFIG, catalog: CATALOG })

  assert.deepEqual(rows.map(row => row.provider), ['deepseek-official', 'zai'])
  assert.deepEqual(rows[0]?.models.map(model => model.id), ['deepseek-flash', 'deepseek-v4-pro'])
  assert.equal(rows[0]?.providerName, 'DeepSeek')
  assert.equal(rows[1]?.models.length, 1)
})

test('a provider resolves with zero configuration and reports what it will show', () => {
  const rows = buildProviderRows({ models: MODELS, config: DEFAULT_CONFIG, catalog: CATALOG })

  assert.deepEqual(rows[0]?.resolution, {
    provider: 'deepseek-official',
    sourceId: 'deepseek',
    mode: 'api',
    reason: 'auto',
    key: 'deepseek:api',
  })
  assert.equal(rows[0]?.selected, 'auto')
  assert.equal(rows[1]?.resolution.key, 'zai:coding-plan')
})

test('each row only offers the modes its source can serve', () => {
  const rows = buildProviderRows({ models: MODELS, config: DEFAULT_CONFIG, catalog: CATALOG })

  assert.deepEqual(rows[0]?.modes, ['auto', 'api', 'hidden'])
  assert.deepEqual(rows[1]?.modes, ['auto', 'coding-plan', 'hidden'])
})

test('an explicit choice is reflected in the row', () => {
  const config = configWith({ providers: { 'deepseek-official': { mode: 'hidden' } } })

  const rows = buildProviderRows({ models: MODELS, config, catalog: CATALOG })

  assert.equal(rows[0]?.selected, 'hidden')
  assert.equal(rows[0]?.resolution.reason, 'hidden')
})

test('a provider held back for a missing endpoint says so instead of pretending', () => {
  const rows = buildProviderRows({
    models: [{ provider: 'sub2api', providerName: 'Sub2API', model: 'gpt-5', name: 'gpt-5' }],
    config: DEFAULT_CONFIG,
    catalog: CATALOG,
  })

  assert.deepEqual(rows[0]?.modes, ['auto', 'api', 'coding-plan', 'hidden'])
  assert.equal(rows[0]?.resolution.reason, 'needs-endpoint')
  assert.equal(rows[0]?.resolution.key, undefined)
})

test('an endpoint hint sharpens the suggestion for a provider whose id says nothing', () => {
  const rows = buildProviderRows({
    models: [{ provider: 'my-relay', providerName: 'Relay', model: 'glm', name: 'GLM' }],
    config: DEFAULT_CONFIG,
    catalog: CATALOG,
    endpointHints: { 'my-relay': 'https://open.bigmodel.cn/api/paas/v4' },
  })

  assert.equal(rows[0]?.resolution.sourceId, 'zai')
  assert.deepEqual(rows[0]?.modes, ['auto', 'coding-plan', 'hidden'])
})

test('a configured provider that left the catalog keeps a row with no models', () => {
  const config = configWith({ providers: { ghost: { mode: 'api', sourceId: 'deepseek' } } })

  const rows = buildProviderRows({ models: [], config, catalog: CATALOG })

  assert.deepEqual(rows.map(row => row.provider), ['ghost'])
  assert.deepEqual(rows[0]?.models, [])
  assert.equal(rows[0]?.selected, 'api')
})

test('a provider DSH no longer has loses its row even though a mode is stored', () => {
  // Picking a mode persists an entry. Deleting the provider in DSH must not leave
  // that entry on the page forever: the live registry is the source of truth.
  const config = configWith({ providers: { 'opencode-go': { mode: 'coding-plan' } } })

  const rows = buildProviderRows({
    models: MODELS,
    config,
    catalog: CATALOG,
    registry: { routable: ['deepseek-official', 'zai'], failed: [] },
  })

  assert.deepEqual(rows.map(row => row.provider), ['deepseek-official', 'zai'])
})

test('a provider DSH still has but that lists no models loses its row too', () => {
  // DSH filters zero-model groups out of the catalog, so the provider vanishes
  // from the model list the user sees; our row has to follow it.
  const config = configWith({ providers: { 'opencode-go': { mode: 'coding-plan' } } })

  const rows = buildProviderRows({
    models: MODELS,
    config,
    catalog: CATALOG,
    registry: { routable: ['deepseek-official', 'zai', 'opencode-go'], failed: [] },
  })

  assert.deepEqual(rows.map(row => row.provider), ['deepseek-official', 'zai'])
})

test('a provider DSH still has, but whose models could not be listed, keeps its row', () => {
  // Present in the registry with a failed model listing: still a real provider, so
  // its configuration stays reachable instead of silently disappearing.
  const config = configWith({ providers: { 'flaky-relay': { mode: 'api', sourceId: 'deepseek' } } })

  const rows = buildProviderRows({
    models: [],
    config,
    catalog: CATALOG,
    registry: { routable: ['flaky-relay'], failed: ['flaky-relay'] },
  })

  assert.deepEqual(rows.map(row => row.provider), ['flaky-relay'])
  assert.deepEqual(rows[0]?.models, [])
})

test('rows follow the stored order, then the catalog order', () => {
  const config = configWith({ order: ['zai'] })

  const rows = buildProviderRows({ models: MODELS, config, catalog: CATALOG })

  assert.deepEqual(rows.map(row => row.provider), ['zai', 'deepseek-official'])
})

test('setProviderMode keeps other overrides and other providers intact', () => {
  const providers = { zai: { mode: 'coding-plan' as const, baseUrl: 'https://open.bigmodel.cn' } }

  const next = setProviderMode(providers, 'zai', 'hidden')

  assert.deepEqual(next, { zai: { mode: 'hidden', baseUrl: 'https://open.bigmodel.cn' } })
  assert.equal(providers.zai.mode, 'coding-plan', 'the input is not mutated')

  const added = setProviderMode(providers, 'deepseek-official', 'auto')
  assert.deepEqual(added['deepseek-official'], { mode: 'auto' })
})

test('reorderProviders swaps neighbours and refuses to move past either end', () => {
  const order = ['a', 'b', 'c']

  assert.deepEqual(reorderProviders(order, 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(reorderProviders(order, 'b', 1), ['a', 'c', 'b'])
  assert.equal(reorderProviders(order, 'a', -1), undefined)
  assert.equal(reorderProviders(order, 'c', 1), undefined)
  assert.equal(reorderProviders(order, 'missing', 1), undefined)
})
