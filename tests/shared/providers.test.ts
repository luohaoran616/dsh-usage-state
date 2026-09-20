import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_CONFIG, normalizeConfig, type UsageStateConfig } from '../../src/shared/config.ts'
import { orderProviders, originOf, resolveProvider } from '../../src/shared/providers.ts'
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

function configWith(patch: Partial<UsageStateConfig>): UsageStateConfig {
  return normalizeConfig({ ...DEFAULT_CONFIG, ...patch })
}

test('providers default to auto mode so nothing has to be configured', () => {
  const config = normalizeConfig({ providers: { 'deepseek-official': {} } })

  assert.deepEqual(config.providers['deepseek-official'], { mode: 'auto' })
})

test('provider entries keep their overrides and reject nonsense', () => {
  const config = normalizeConfig({
    providers: {
      zai: { mode: 'coding-plan', sourceId: ' zai ', baseUrl: ' https://open.bigmodel.cn ', apiKeyRef: ' GLM_KEY ' },
      weird: { mode: 'nonsense', sourceId: 42, baseUrl: '', apiKeyRef: null },
      garbage: 'nope',
    },
  })

  assert.deepEqual(config.providers['zai'], {
    mode: 'coding-plan',
    sourceId: 'zai',
    baseUrl: 'https://open.bigmodel.cn',
    apiKeyRef: 'GLM_KEY',
  })
  assert.deepEqual(config.providers['weird'], { mode: 'auto' })
  assert.equal(config.providers['garbage'], undefined)
})

test('order is deduplicated and always mentions every configured provider', () => {
  const config = normalizeConfig({ order: ['b', ' a ', 'b', ''], providers: { a: {}, c: {} } })

  assert.deepEqual(config.order, ['b', 'a', 'c'])
})

test('legacy per-model choices migrate into provider entries', () => {
  const config = normalizeConfig({
    models: [
      { provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'api' },
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', sourceId: 'deepseek', mode: 'api' },
      { provider: 'zai', model: 'glm-4.6', sourceId: 'zai', mode: 'hidden' },
    ],
  })

  assert.deepEqual(config.providers['deepseek-official'], { mode: 'api', sourceId: 'deepseek' })
  assert.deepEqual(config.providers['zai'], { mode: 'hidden', sourceId: 'zai' })
  assert.deepEqual(config.order, ['deepseek-official', 'zai'])
})

test('an explicit provider entry wins over a migrated legacy one', () => {
  const config = normalizeConfig({
    models: [{ provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'api' }],
    providers: { 'deepseek-official': { mode: 'hidden' } },
  })

  assert.deepEqual(config.providers['deepseek-official'], { mode: 'hidden' })
})

test('a provider DSH already holds a key for resolves with zero configuration', () => {
  const resolution = resolveProvider({ provider: 'deepseek-official', config: DEFAULT_CONFIG, catalog: CATALOG })

  assert.deepEqual(resolution, {
    provider: 'deepseek-official',
    sourceId: 'deepseek',
    mode: 'api',
    reason: 'auto',
    key: 'deepseek:api',
  })
})

test('an explicit choice is reported as configured and keeps its overrides', () => {
  const config = configWith({
    providers: { 'my-glm': { mode: 'coding-plan', sourceId: 'zai', baseUrl: 'https://open.bigmodel.cn', apiKeyRef: 'GLM_KEY' } },
  })

  assert.deepEqual(resolveProvider({ provider: 'my-glm', config, catalog: CATALOG }), {
    provider: 'my-glm',
    sourceId: 'zai',
    mode: 'coding-plan',
    reason: 'configured',
    baseUrl: 'https://open.bigmodel.cn',
    baseUrlPinned: true,
    apiKeyRef: 'GLM_KEY',
    key: 'zai:coding-plan',
  })
})

test('the endpoint declared by the provider picks the data source and is used for real', () => {
  const resolution = resolveProvider({
    provider: 'my-relay',
    config: DEFAULT_CONFIG,
    catalog: CATALOG,
    endpointHint: 'https://open.bigmodel.cn/api/paas/v4',
  })

  assert.equal(resolution.sourceId, 'zai')
  assert.equal(resolution.key, 'zai:coding-plan')
  // Only the origin is usable: adapters append their own path to it.
  assert.equal(resolution.baseUrl, 'https://open.bigmodel.cn')
  assert.equal(resolution.baseUrlPinned, undefined, 'a declared host is a hint, not a pin')
})

test('originOf understands API bases and refuses junk', () => {
  assert.equal(originOf('https://api.z.ai/api/paas/v4'), 'https://api.z.ai')
  assert.equal(originOf(' https://open.bigmodel.cn/ '), 'https://open.bigmodel.cn')
  assert.equal(originOf('http://127.0.0.1:8080/v1'), 'http://127.0.0.1:8080')
  assert.equal(originOf('not a url'), undefined)
  assert.equal(originOf(undefined), undefined)
})

test('hiding a provider removes it from every status line', () => {
  const config = configWith({ providers: { 'deepseek-official': { mode: 'hidden' } } })

  assert.deepEqual(resolveProvider({ provider: 'deepseek-official', config, catalog: CATALOG }), {
    provider: 'deepseek-official',
    sourceId: null,
    mode: null,
    reason: 'hidden',
  })
})

test('a provider nobody can map, or a source that does not exist, resolves to nothing', () => {
  const unknownProvider = resolveProvider({ provider: 'mystery', config: DEFAULT_CONFIG, catalog: CATALOG })
  assert.equal(unknownProvider.reason, 'unknown-source')
  assert.equal(unknownProvider.key, undefined)

  const config = configWith({ providers: { p: { mode: 'api', sourceId: 'ghost' } } })
  const unknownSource = resolveProvider({ provider: 'p', config, catalog: CATALOG })
  assert.deepEqual(unknownSource, { provider: 'p', sourceId: 'ghost', mode: null, reason: 'unknown-source' })
})

test('asking a source for a mode it cannot serve is refused, not silently substituted', () => {
  const config = configWith({ providers: { 'deepseek-official': { mode: 'coding-plan', sourceId: 'deepseek' } } })

  const resolution = resolveProvider({ provider: 'deepseek-official', config, catalog: CATALOG })

  assert.deepEqual(resolution, {
    provider: 'deepseek-official',
    sourceId: 'deepseek',
    mode: null,
    reason: 'unsupported',
  })
})

test('a self-hosted source stays dormant until it has an endpoint', () => {
  const auto = resolveProvider({ provider: 'sub2api', config: DEFAULT_CONFIG, catalog: CATALOG })
  assert.deepEqual(auto, { provider: 'sub2api', sourceId: 'sub2api', mode: null, reason: 'needs-endpoint' })

  const configured = configWith({ providers: { sub2api: { mode: 'api', sourceId: 'sub2api', baseUrl: 'https://gw.example.com' } } })
  const resolved = resolveProvider({ provider: 'sub2api', config: configured, catalog: CATALOG })
  assert.equal(resolved.key, 'sub2api:api')
  assert.equal(resolved.reason, 'configured')
})

test('orderProviders keeps the configured order and appends newcomers', () => {
  const config = configWith({ order: ['zai'] })

  assert.deepEqual(orderProviders(['deepseek-official', 'zai', 'newcomer'], config), ['zai', 'deepseek-official', 'newcomer'])
  assert.deepEqual(orderProviders([], config), [])
})
