import test from 'node:test'
import assert from 'node:assert/strict'

import { UsageStateService, type UsageStateServiceDeps } from '../../src/host/service.ts'
import type { CredentialDescription } from '../../src/host/credentials.ts'
import type { UsageSnapshot } from '../../src/shared/types.ts'
import type { UsageTarget } from '../../src/host/targets.ts'

const DS: UsageTarget = { key: 'deepseek:api', sourceId: 'deepseek', mode: 'api' }
const ZAI: UsageTarget = { key: 'zai:coding-plan', sourceId: 'zai', mode: 'coding-plan' }

const SNAPSHOT: UsageSnapshot = {
  sourceId: 'deepseek',
  mode: 'api',
  balances: [{ amount: 66.28, currency: 'CNY' }],
  windows: [],
  fetchedAt: 1_000,
}

function harness(overrides: Partial<UsageStateServiceDeps> = {}) {
  const calls: Array<{ key: string; force: boolean }> = []
  const described: string[] = []
  const deps: UsageStateServiceDeps = {
    store: {
      refresh: async (key, options) => {
        calls.push({ key, force: options?.force === true })
        return SNAPSHOT
      },
      snapshots: () => ({ 'deepseek:api': SNAPSHOT }),
    },
    targets: () => [DS, ZAI],
    catalog: () => [
      {
        id: 'deepseek',
        displayName: 'DeepSeek',
        modes: ['api'],
        requiresBaseUrl: false,
        defaultBaseUrl: { api: 'https://api.deepseek.com' },
        credentialRefs: { api: ['DEEPSEEK_API_KEY'] },
      },
    ],
    describe: async target => {
      described.push(target.key)
      return { candidates: [], configured: false } satisfies CredentialDescription
    },
    now: () => 4_242,
    ...overrides,
  }
  return { service: new UsageStateService(deps), calls, described }
}

test('getState refreshes every target without forcing and reports the current readings', async () => {
  const { service, calls } = harness()

  const state = await service.getState(false)

  assert.deepEqual(calls, [
    { key: 'deepseek:api', force: false },
    { key: 'zai:coding-plan', force: false },
  ])
  assert.equal(state.checkedAt, 4_242)
  assert.deepEqual(state.snapshots['deepseek:api'], SNAPSHOT)
  assert.equal(state.sources.length, 1)
})

test('getState forces when the caller asks, so the settings page can refresh on demand', async () => {
  const { service, calls } = harness()

  await service.getState(true)

  assert.deepEqual(calls, [
    { key: 'deepseek:api', force: true },
    { key: 'zai:coding-plan', force: true },
  ])
})

test('getState tolerates an omitted force argument (the wire allows undefined)', async () => {
  const { service, calls } = harness()

  await service.getState(undefined as unknown as boolean)

  assert.deepEqual(calls.map(call => call.force), [false, false])
})

test('describeCredentials keys the report by target so the page can align it with the catalog', async () => {
  const { service, described } = harness()

  const report = await service.describeCredentials()

  assert.deepEqual(described, ['deepseek:api', 'zai:coding-plan'])
  assert.deepEqual(Object.keys(report.credentials), ['deepseek:api', 'zai:coding-plan'])
  assert.equal(report.credentials['zai:coding-plan']?.configured, false)
})

test('getState carries on when one target cannot be refreshed', async () => {
  const { service } = harness({
    store: {
      refresh: async key => {
        if (key === 'zai:coding-plan') throw new Error('should not propagate')
        return SNAPSHOT
      },
      snapshots: () => ({ 'deepseek:api': SNAPSHOT }),
    },
  })

  const state = await service.getState(false)

  assert.deepEqual(Object.keys(state.snapshots), ['deepseek:api'])
})
