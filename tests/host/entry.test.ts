import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, createUsageState, inject, name, type PluginContextLike } from '../../src/index.ts'
import type { FetchLike } from '../../src/host/read.ts'
import type { SettingsSchemaLike, SettingsScopeLike } from '../../src/host/settings.ts'

const BALANCE_BODY = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '66.28' }] }

interface Timer {
  at: number
  every: number | undefined
  fn: () => void
  cancelled: boolean
}

/** A cordis-shaped context that records what the plugin asks the host for. */
function contextStub(options: { settings?: Record<string, unknown>; credentials?: Record<string, string> } = {}) {
  const provided = new Map<string, unknown>()
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const timers: Timer[] = []
  let now = 0

  const scope: SettingsScopeLike = {
    get: () => options.settings?.['usage-state'] ?? {},
    watch: () => () => undefined,
  }

  const ctx = {
    inject(names: readonly string[], callback: (ctx: { settings: { register: (ns: string, schema: SettingsSchemaLike) => SettingsScopeLike } }) => void) {
      if (names.includes('settings')) {
        callback({ settings: { register: () => scope } })
      }
    },
    get(name: string) {
      if (name === 'credentials') {
        return {
          resolve: async (ref: string) => {
            const value = options.credentials?.[ref]
            return value === undefined ? undefined : { value, source: 'store' }
          },
          describe: async (ref: string) => ({ configured: options.credentials?.[ref] !== undefined, writable: true }),
        }
      }
      if (name === 'settings') {
        return { get: (ns: string) => options.settings?.[ns] }
      }
      return undefined
    },
    on(event: string, handler: (...args: unknown[]) => void) {
      const list = listeners.get(event) ?? []
      list.push(handler)
      listeners.set(event, list)
      return () => undefined
    },
    effect(callback: () => (() => void) | void) {
      callback()
    },
    provide(key: string, value: unknown) {
      provided.set(key, value)
    },
    timeout(fn: () => void, delay: number) {
      const timer: Timer = { at: now + delay, every: undefined, fn, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    interval(fn: () => void, delay: number) {
      const timer: Timer = { at: now + delay, every: delay, fn, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  } as unknown as PluginContextLike

  return {
    ctx,
    provided,
    listeners,
    timers,
    /** The stub's clock source, so the plugin's timers and the store agree on "now". */
    time: () => now,
    emit(event: string, ...args: unknown[]) {
      for (const handler of listeners.get(event) ?? []) handler(...args)
    },
    async advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = timers
          .filter(timer => !timer.cancelled && timer.at <= target)
          .sort((a, b) => a.at - b.at)[0]
        if (due === undefined) break
        now = due.at
        if (due.every === undefined) due.cancelled = true
        else due.at += due.every
        due.fn()
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      now = target
    },
  }
}

const CONFIGURED = {
  'usage-state': {
    models: [{ provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'api' }],
  },
}

function fetchStub(): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = []
  return {
    urls,
    fetch: async url => {
      urls.push(url)
      return { ok: true, status: 200, json: async () => BALANCE_BODY }
    },
  }
}

test('the plugin declares its cordis identity', () => {
  assert.equal(name, 'usage-state')
  assert.ok(inject.includes('timer'), 'the refresh timers come from the cordis timer plugin')
})

test('applying the plugin provides the service under the name the gateway resolves', () => {
  const host = contextStub({ settings: CONFIGURED, credentials: { DEEPSEEK_API_KEY: 'sk-test' } })
  const { fetch } = fetchStub()

  const service = createUsageState(host.ctx, { fetch, now: host.time, credentialFallback: false })

  assert.equal(host.provided.get('usageState'), service)

  // Mirrors dsh-api-gateway's readBinding: `service` is the service OBJECT, and a
  // string there fails every dispatch with gateway/binding-invalid.
  const binding = (service as unknown as { typertRemote?: { service: unknown; serviceKey: string; namespace: string } })
    .typertRemote
  assert.equal(binding?.service, service)
  assert.equal(binding?.serviceKey, 'usageState')
  assert.equal(binding?.namespace, 'usageState')
  assert.equal(Object.keys(service).includes('typertRemote'), false, 'the binding is hidden from enumeration')
})

test('getState reads the configured model and returns its balance', async () => {
  const host = contextStub({ settings: CONFIGURED, credentials: { DEEPSEEK_API_KEY: 'sk-test' } })
  const { fetch, urls } = fetchStub()

  const service = createUsageState(host.ctx, { fetch, now: host.time, credentialFallback: false })
  const state = await service.getState(false)

  assert.deepEqual(urls, ['https://api.deepseek.com/user/balance'])
  assert.deepEqual(state.snapshots['deepseek:api']?.balances, [{ amount: 66.28, currency: 'CNY' }])
  assert.equal(state.sources.length, 5)
})

const OPENCODE_BODY = {
  usage: {
    rolling: { status: 'ok', percent: 12.5, resetsAt: '2026-09-21T10:08:43.658Z' },
    weekly: { status: 'ok', percent: 6, resetsAt: '2026-09-28T00:00:00.658Z' },
    monthly: { status: 'ok', percent: 2, resetsAt: '2026-10-21T03:42:07.658Z' },
  },
}

test('both OpenCode Go routes share one target, one request and one 5h/7d/30d reading', async () => {
  const host = contextStub({
    settings: { 'usage-state': { providers: { 'opencode-go': {}, 'opencode-go-deepseek': {} } } },
    credentials: { OPENCODE_GO_API_KEY: 'sk-go' },
  })
  const urls: string[] = []
  const fetch: FetchLike = async url => {
    urls.push(url)
    return { ok: true, status: 200, json: async () => OPENCODE_BODY }
  }

  const service = createUsageState(host.ctx, { fetch, now: host.time, credentialFallback: false })
  const state = await service.getState(false)

  assert.deepEqual(urls, ['https://opencode.ai/zen/go/v1/usage'])
  assert.deepEqual(state.snapshots['opencode:coding-plan']?.windows.map(window => window.id), ['5h', '7d', '30d'])
  assert.equal(state.snapshots['opencode:coding-plan']?.windows[0]?.usedPercent, 12.5)
})

test('a model nobody configured produces no poll target at all', async () => {
  const host = contextStub({ settings: {}, credentials: { DEEPSEEK_API_KEY: 'sk-test' } })
  const { fetch, urls } = fetchStub()

  const service = createUsageState(host.ctx, { fetch, now: host.time, credentialFallback: false })
  const state = await service.getState(false)

  assert.deepEqual(urls, [])
  assert.deepEqual(state.snapshots, {})
})

test('a missing credential is reported as a configuration problem, not a fake balance', async () => {
  const host = contextStub({ settings: CONFIGURED })
  const { fetch, urls } = fetchStub()

  const service = createUsageState(host.ctx, { fetch, now: host.time, credentialFallback: false })
  const state = await service.getState(false)

  assert.deepEqual(urls, [])
  assert.equal(state.snapshots['deepseek:api']?.error?.kind, 'config')
})

test('describeCredentials reports status for every configured target without a secret', async () => {
  const host = contextStub({ settings: CONFIGURED, credentials: { DEEPSEEK_API_KEY: 'sk-test' } })
  const service = createUsageState(host.ctx, { fetch: fetchStub().fetch, now: host.time, credentialFallback: false })

  const report = await service.describeCredentials()

  assert.deepEqual(Object.keys(report.credentials), ['deepseek:api'])
  const description = report.credentials['deepseek:api']
  assert.equal(description?.configured, true)
  assert.equal(description?.ref, 'DEEPSEEK_API_KEY')
  assert.equal(JSON.stringify(report).includes('sk-test'), false)
})

test('the provider-configured apiKeyEnv is probed before the built-in ref', async () => {
  const host = contextStub({
    settings: { ...CONFIGURED, 'llm-deepseek': { apiKeyEnv: 'TEAM_KEY' } },
    credentials: { TEAM_KEY: 'sk-team', DEEPSEEK_API_KEY: 'sk-personal' },
  })
  const service = createUsageState(host.ctx, { fetch: fetchStub().fetch, now: host.time, credentialFallback: false })

  const report = await service.describeCredentials()

  assert.equal(report.credentials['deepseek:api']?.ref, 'TEAM_KEY')
})

test('a finished turn schedules a refresh, and the idle timer keeps polling', async () => {
  const host = contextStub({ settings: CONFIGURED, credentials: { DEEPSEEK_API_KEY: 'sk-test' } })
  const { fetch, urls } = fetchStub()

  createUsageState(host.ctx, { fetch, now: host.time, credentialFallback: false })

  host.emit('session/event', { id: 's1' }, { type: 'turn/end' })
  host.emit('session/event', { id: 's1' }, { type: 'tool/call' })
  assert.equal(urls.length, 0, 'the refresh waits for the provider to settle')

  await host.advance(2000)
  assert.equal(urls.length, 1)

  await host.advance(5 * 60_000)
  assert.equal(urls.length, 2, 'the idle timer keeps the reading fresh')
})

test('apply() wires the real host context without a fetch override', () => {
  const host = contextStub({ settings: CONFIGURED, credentials: { DEEPSEEK_API_KEY: 'sk-test' } })

  assert.doesNotThrow(() => createUsageState(host.ctx, { credentialFallback: false }))
  assert.ok(host.provided.get('usageState') !== undefined)
})

test('a provider that declares a base URL is polled at that host', async () => {
  const host = contextStub({
    settings: {
      'usage-state': { providers: { 'zai-coding': { mode: 'coding-plan' } } },
      // Exactly how a DSH provider profile declares its API base.
      'llm-pi-ai': { providers: { 'zai-coding': { apiKeyEnv: 'ZAI_KEY', baseURL: 'https://api.z.ai/api/paas/v4' } } },
    },
    credentials: { ZAI_KEY: 'sk-zai' },
  })
  const urls: string[] = []
  const fetch: FetchLike = async url => {
    urls.push(url)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          limits: [
            { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 42 },
            { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 18 },
          ],
        },
      }),
    }
  }

  const service = createUsageState(host.ctx, { fetch, now: host.time, credentialFallback: false })
  const state = await service.getState(false)

  assert.deepEqual(urls, ['https://api.z.ai/api/monitor/usage/quota/limit'])
  assert.deepEqual(state.snapshots['zai:coding-plan']?.windows.map(window => window.id), ['5h', '7d'])
})
