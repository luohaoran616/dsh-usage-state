import test from 'node:test'
import assert from 'node:assert/strict'

import { buildModelRows, configureModel, reorderModels, rowKey } from '../../src/client/model-rows.ts'
import { DEFAULT_CONFIG, type ModelConfigEntry, type UsageStateConfig } from '../../src/shared/config.ts'
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
]

const MODELS = [
  { provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-flash', name: 'DeepSeek Flash' },
  { provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { provider: 'zai', providerName: 'z.ai / GLM', model: 'glm-4.6', name: 'GLM-4.6' },
]

function configWith(models: ModelConfigEntry[]): UsageStateConfig {
  return { ...DEFAULT_CONFIG, models }
}

test('rowKey uses a separator that cannot appear in provider or model ids', () => {
  assert.equal(rowKey('a', 'b'), 'a\u0000b')
  assert.notEqual(rowKey('a b', 'c'), rowKey('a', 'b c'))
  assert.notEqual(rowKey('a/b', 'c'), rowKey('a', 'b/c'))
})

test('rows list configured models first, in configured order, then the rest of the catalog', () => {
  const rows = buildModelRows({
    models: MODELS,
    catalog: CATALOG,
    config: configWith([{ provider: 'zai', model: 'glm-4.6', sourceId: 'zai', mode: 'coding-plan' }]),
  })

  assert.deepEqual(
    rows.map(row => row.key),
    [rowKey('zai', 'glm-4.6'), rowKey('deepseek-official', 'deepseek-flash'), rowKey('deepseek-official', 'deepseek-v4-pro')],
  )
  assert.equal(rows[0]?.mode, 'coding-plan')
  assert.equal(rows[0]?.unconfigured, false)
  assert.equal(rows[1]?.unconfigured, true)
})

test('each row offers the modes of its source plus hidden', () => {
  const rows = buildModelRows({
    models: MODELS,
    catalog: CATALOG,
    config: configWith([
      { provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'api' },
      { provider: 'zai', model: 'glm-4.6', sourceId: 'zai', mode: 'coding-plan' },
    ]),
  })

  assert.deepEqual(rows.find(row => row.model === 'deepseek-flash')?.modes, ['api', 'hidden'])
  assert.deepEqual(rows.find(row => row.model === 'glm-4.6')?.modes, ['coding-plan', 'hidden'])
})

test('an unconfigured model gets a suggested source from its provider id', () => {
  const rows = buildModelRows({ models: MODELS, catalog: CATALOG, config: configWith([]) })

  assert.equal(rows.find(row => row.provider === 'deepseek-official')?.sourceId, 'deepseek')
  assert.equal(rows.find(row => row.provider === 'zai')?.sourceId, 'zai')
  assert.equal(rows.find(row => row.provider === 'deepseek-official')?.mode, 'hidden')
})

test('a configured model that left the catalog still shows up, so it can be cleaned up', () => {
  const rows = buildModelRows({
    models: MODELS,
    catalog: CATALOG,
    config: configWith([{ provider: 'gone', model: 'retired', sourceId: 'deepseek', mode: 'api' }]),
  })

  const row = rows.find(candidate => candidate.model === 'retired')
  assert.equal(row?.providerName, 'gone')
  assert.equal(row?.name, 'retired')
  assert.equal(row?.unconfigured, false)
})

test('an unknown source id leaves every mode selectable rather than guessing', () => {
  const rows = buildModelRows({
    models: MODELS,
    catalog: CATALOG,
    config: configWith([{ provider: 'gone', model: 'retired', sourceId: 'ghost', mode: 'api' }]),
  })

  assert.deepEqual(rows[0]?.modes, ['api', 'coding-plan', 'hidden'])
})

test('configureModel appends a new model and keeps the existing order intact', () => {
  const models: ModelConfigEntry[] = [{ provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'api' }]

  const next = configureModel(models, { provider: 'zai', model: 'glm-4.6', sourceId: 'zai', mode: 'coding-plan' })

  assert.deepEqual(next, [
    { provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'api' },
    { provider: 'zai', model: 'glm-4.6', sourceId: 'zai', mode: 'coding-plan' },
  ])
  assert.deepEqual(models.length, 1, 'the input array is not mutated')
})

test('configureModel updates in place when the model is already configured', () => {
  const models: ModelConfigEntry[] = [
    { provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'api' },
    { provider: 'zai', model: 'glm-4.6', sourceId: 'zai', mode: 'coding-plan' },
  ]

  const next = configureModel(models, { provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'zai', mode: 'hidden' })

  assert.deepEqual(next, [
    { provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'zai', mode: 'hidden' },
    { provider: 'zai', model: 'glm-4.6', sourceId: 'zai', mode: 'coding-plan' },
  ])
})

test('reorderModels swaps neighbours and refuses to move past either end', () => {
  const models: ModelConfigEntry[] = [
    { provider: 'a', model: '1', sourceId: 'deepseek', mode: 'api' },
    { provider: 'b', model: '2', sourceId: 'deepseek', mode: 'api' },
    { provider: 'c', model: '3', sourceId: 'deepseek', mode: 'api' },
  ]

  assert.deepEqual(reorderModels(models, rowKey('b', '2'), -1)?.map(entry => entry.provider), ['b', 'a', 'c'])
  assert.deepEqual(reorderModels(models, rowKey('b', '2'), 1)?.map(entry => entry.provider), ['a', 'c', 'b'])
  assert.equal(reorderModels(models, rowKey('a', '1'), -1), undefined)
  assert.equal(reorderModels(models, rowKey('c', '3'), 1), undefined)
  assert.equal(reorderModels(models, rowKey('missing', 'x'), 1), undefined)
})
