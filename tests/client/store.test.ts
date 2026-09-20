import test from 'node:test'
import assert from 'node:assert/strict'

import { flattenCatalog, UsageStateClientStore } from '../../src/client/store.ts'
import type { ModelCatalogLike } from '../../src/client/context.ts'
import type { CredentialReport, RemoteResult, UsageStateView } from '../../src/shared/rpc.ts'

const VIEW: UsageStateView = {
  sources: [
    {
      id: 'deepseek',
      displayName: 'DeepSeek',
      modes: ['api'],
      requiresBaseUrl: false,
      defaultBaseUrl: { api: 'https://api.deepseek.com' },
      credentialRefs: { api: ['DEEPSEEK_API_KEY'] },
    },
  ],
  snapshots: {
    'deepseek:api': {
      sourceId: 'deepseek',
      mode: 'api',
      balances: [{ amount: 66.28, currency: 'CNY' }],
      windows: [],
      fetchedAt: 1_000,
    },
  },
  checkedAt: 1_000,
}

const REPORT: CredentialReport = {
  credentials: {
    'deepseek:api': {
      candidates: [{ ref: 'DEEPSEEK_API_KEY', configured: true, source: 'env' }],
      configured: true,
      ref: 'DEEPSEEK_API_KEY',
    },
  },
}

interface HarnessOptions {
  view?: RemoteResult<UsageStateView>
  report?: RemoteResult<CredentialReport>
  catalog?: RemoteResult<ModelCatalogLike>
  throws?: boolean
  gate?: boolean
}

const MODEL_CATALOG: ModelCatalogLike = {
  groups: [
    { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] },
    { id: 'zai', name: 'z.ai / GLM', models: [{ id: 'glm-4.6', name: 'GLM-4.6' }] },
  ],
}

function harness(options: HarnessOptions = {}) {
  const calls: boolean[] = []
  let resolveGate: (() => void) | undefined
  const gate = new Promise<void>(resolve => {
    resolveGate = resolve
  })

  const store = new UsageStateClientStore({
    getState: async force => {
      calls.push(force)
      if (options.throws === true) throw new Error('boom')
      if (options.gate === true) await gate
      return options.view ?? { ok: true, value: VIEW }
    },
    describeCredentials: async () => options.report ?? { ok: true, value: REPORT },
    modelCatalog: async () => options.catalog ?? { ok: true, value: MODEL_CATALOG },
  })

  return { store, calls, release: () => resolveGate?.() }
}

test('a fresh store is idle and empty', () => {
  const { store } = harness()

  assert.deepEqual(store.getSnapshot(), {
    status: 'idle',
    catalog: [],
    snapshots: {},
    credentials: {},
    checkedAt: undefined,
    models: [],
    error: undefined,
    credentialsError: undefined,
    modelsError: undefined,
  })
})

test('refresh publishes the view and notifies subscribers', async () => {
  const { store, calls } = harness()
  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })

  await store.refresh(false)

  const state = store.getSnapshot()
  assert.equal(state.status, 'ready')
  assert.equal(state.catalog.length, 1)
  assert.deepEqual(state.snapshots['deepseek:api']?.balances, [{ amount: 66.28, currency: 'CNY' }])
  assert.equal(state.checkedAt, 1_000)
  assert.deepEqual(calls, [false])
  assert.ok(notifications >= 1)
})

test('force is passed through for the explicit refresh affordance', async () => {
  const { store, calls } = harness()

  await store.refresh(true)

  assert.deepEqual(calls, [true])
})

test('a failure after a success keeps the last readings and records the reason', async () => {
  let fail = false
  const store = new UsageStateClientStore({
    getState: async () => (fail ? { ok: false, error: { message: 'rpc down' } } : { ok: true, value: VIEW }),
    describeCredentials: async () => ({ ok: true, value: REPORT }),
  })

  await store.refresh(false)
  fail = true
  await store.refresh(false)

  const state = store.getSnapshot()
  assert.equal(state.status, 'error')
  assert.equal(state.error, 'rpc down')
  assert.deepEqual(state.snapshots['deepseek:api']?.balances, [{ amount: 66.28, currency: 'CNY' }])
  assert.equal(state.catalog.length, 1)
})

test('a first failure reports the error without inventing data', async () => {
  const { store } = harness({ view: { ok: false, error: { message: 'rpc down' } } })

  await store.refresh(false)

  assert.equal(store.getSnapshot().status, 'error')
  assert.equal(store.getSnapshot().error, 'rpc down')
  assert.deepEqual(store.getSnapshot().snapshots, {})
})

test('a thrown error is recorded like a returned failure', async () => {
  const { store } = harness({ throws: true })

  await store.refresh(false)

  assert.equal(store.getSnapshot().status, 'error')
  assert.equal(store.getSnapshot().error, 'boom')
})

test('concurrent refreshes share one call', async () => {
  const { store, calls, release } = harness({ gate: true })
  const first = store.refresh(false)
  const second = store.refresh(false)
  release()
  await Promise.all([first, second])

  assert.deepEqual(calls, [false])
})

test('refreshCredentials fills the status the settings page shows', async () => {
  const { store } = harness()

  await store.refreshCredentials()

  assert.equal(store.getSnapshot().credentials['deepseek:api']?.configured, true)
  assert.equal(store.getSnapshot().credentialsError, undefined)
})

test('a failing credential lookup keeps the previous status', async () => {
  const store = new UsageStateClientStore({
    getState: async () => ({ ok: true, value: VIEW }),
    describeCredentials: async () => {
      throw new Error('no credentials service')
    },
  })

  await store.refreshCredentials()

  assert.deepEqual(store.getSnapshot().credentials, {})
  assert.equal(store.getSnapshot().credentialsError, 'no credentials service')
})

test('unsubscribing stops notifications', async () => {
  const { store } = harness()
  let notifications = 0
  const unsubscribe = store.subscribe(() => {
    notifications += 1
  })
  unsubscribe()

  await store.refresh(false)

  assert.equal(notifications, 0)
})

test('flattenCatalog turns provider groups into flat rows and survives a missing catalog', () => {
  assert.deepEqual(flattenCatalog(MODEL_CATALOG), [
    { provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-flash', name: 'DeepSeek Flash' },
    { provider: 'zai', providerName: 'z.ai / GLM', model: 'glm-4.6', name: 'GLM-4.6' },
  ])
  assert.deepEqual(flattenCatalog(undefined), [])
})

test('refreshModels fills the settings page model list', async () => {
  const { store } = harness()

  await store.refreshModels()

  assert.deepEqual(store.getSnapshot().models.map(row => row.model), ['deepseek-flash', 'glm-4.6'])
  assert.equal(store.getSnapshot().modelsError, undefined)
})

test('a failing model catalog keeps the previous list and records why', async () => {
  let fail = false
  const store = new UsageStateClientStore({
    getState: async () => ({ ok: true, value: VIEW }),
    describeCredentials: async () => ({ ok: true, value: REPORT }),
    modelCatalog: async () =>
      fail ? { ok: false, error: { message: 'llm unavailable' } } : { ok: true, value: MODEL_CATALOG },
  })

  await store.refreshModels()
  fail = true
  await store.refreshModels()

  assert.equal(store.getSnapshot().models.length, 2)
  assert.equal(store.getSnapshot().modelsError, 'llm unavailable')
})
