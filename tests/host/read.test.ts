import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_TIMEOUT_MS, failureKindForStatus, readUsage, type FetchLike } from '../../src/host/read.ts'
import { deepseek } from '../../src/host/sources/deepseek.ts'
import { sub2api } from '../../src/host/sources/sub2api.ts'
import { SourceError } from '../../src/host/sources/types.ts'

interface Call {
  url: string
  headers: Record<string, string>
  signal: AbortSignal | undefined
}

function fetchStub(
  respond: (url: string) => { ok: boolean; status: number; body?: unknown; jsonThrows?: boolean } | Promise<never>,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, signal: init.signal })
    const result = await respond(url)
    return {
      ok: result.ok,
      status: result.status,
      json: async () => {
        if (result.jsonThrows === true) throw new SyntaxError('Unexpected token < in JSON')
        return result.body
      },
    }
  }
  return { fetch, calls }
}

const BALANCE_BODY = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '66.28' }] }

/** A minimal monitor payload for the mirror tests. */
const MONITOR_BODY = {
  success: true,
  data: {
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 42 },
      { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 18 },
    ],
  },
}

test('readUsage performs the request the adapter describes and parses the payload', async () => {
  const { fetch, calls } = fetchStub(() => ({ ok: true, status: 200, body: BALANCE_BODY }))

  const reading = await readUsage({ source: deepseek, mode: 'api', apiKey: 'sk-test' }, { fetch })

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, 'https://api.deepseek.com/user/balance')
  assert.equal(calls[0]?.headers.authorization, 'Bearer sk-test')
  assert.deepEqual(reading.balances, [{ amount: 66.28, currency: 'CNY' }])
})

test('readUsage applies a default timeout signal, and omits it when the timeout is disabled', async () => {
  const { fetch, calls } = fetchStub(() => ({ ok: true, status: 200, body: BALANCE_BODY }))

  await readUsage({ source: deepseek, mode: 'api', apiKey: 'k' }, { fetch })
  await readUsage({ source: deepseek, mode: 'api', apiKey: 'k' }, { fetch, timeoutMs: 0 })

  assert.ok(DEFAULT_TIMEOUT_MS > 0)
  assert.ok(calls[0]?.signal instanceof AbortSignal)
  assert.equal(calls[1]?.signal, undefined)
})

test('readUsage classifies HTTP failures so the UI can explain them', async () => {
  for (const [status, kind] of [
    [401, 'auth'],
    [403, 'auth'],
    [404, 'http'],
    [429, 'http'],
    [500, 'http'],
  ] as const) {
    const { fetch } = fetchStub(() => ({ ok: false, status }))
    await assert.rejects(
      () => readUsage({ source: deepseek, mode: 'api', apiKey: 'k' }, { fetch }),
      (error: unknown) => error instanceof SourceError && error.kind === kind && error.message === `HTTP ${status}`,
      `expected HTTP ${status} to become a ${kind} failure`,
    )
  }

  assert.equal(failureKindForStatus(200), 'http')
})

test('readUsage reports a transport failure as a network problem', async () => {
  const fetch: FetchLike = async () => {
    throw new TypeError('fetch failed')
  }

  await assert.rejects(
    () => readUsage({ source: deepseek, mode: 'api', apiKey: 'k' }, { fetch }),
    (error: unknown) => error instanceof SourceError && error.kind === 'network' && error.message === 'fetch failed',
  )
})

test('readUsage reports an aborted request as a network problem', async () => {
  const fetch: FetchLike = async () => {
    const abort = new Error('The operation was aborted due to timeout')
    abort.name = 'TimeoutError'
    throw abort
  }

  await assert.rejects(
    () => readUsage({ source: deepseek, mode: 'api', apiKey: 'k' }, { fetch }),
    (error: unknown) => error instanceof SourceError && error.kind === 'network',
  )
})

test('readUsage reports a non-JSON body as a parse failure', async () => {
  const { fetch } = fetchStub(() => ({ ok: true, status: 200, jsonThrows: true }))

  await assert.rejects(
    () => readUsage({ source: deepseek, mode: 'api', apiKey: 'k' }, { fetch }),
    (error: unknown) => error instanceof SourceError && error.kind === 'parse' && error.message.startsWith('invalid JSON'),
  )
})

test('readUsage lets the adapter reject a payload it cannot read', async () => {
  const { fetch } = fetchStub(() => ({ ok: true, status: 200, body: { unexpected: true } }))

  await assert.rejects(
    () => readUsage({ source: deepseek, mode: 'api', apiKey: 'k' }, { fetch }),
    (error: unknown) => error instanceof SourceError && error.kind === 'parse',
  )
})

test('readUsage surfaces a configuration problem without touching the network', async () => {
  const { fetch, calls } = fetchStub(() => ({ ok: true, status: 200, body: {} }))

  await assert.rejects(
    () => readUsage({ source: sub2api, mode: 'api', apiKey: 'sk-abc' }, { fetch }),
    (error: unknown) => error instanceof SourceError && error.kind === 'config',
  )
  assert.equal(calls.length, 0)
})

test('readUsage falls through to a mirror endpoint when the primary rejects the key', async () => {
  const { zai } = await import('../../src/host/sources/zai.ts')
  const urls: string[] = []
  const fetch: FetchLike = async url => {
    urls.push(url)
    // The China host answers a global key with an authentication envelope.
    if (url.includes('open.bigmodel.cn')) {
      return { ok: true, status: 200, json: async () => ({ code: 1000, msg: '身份验证失败。', success: false }) }
    }
    return { ok: true, status: 200, json: async () => MONITOR_BODY }
  }

  const reading = await readUsage({ source: zai, mode: 'coding-plan', apiKey: 'k' }, { fetch })

  assert.deepEqual(urls, [
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    'https://api.z.ai/api/monitor/usage/quota/limit',
  ])
  assert.deepEqual(reading.windows.map(window => window.id), ['5h', '7d'])
})

test('readUsage reports an answered failure over an unreachable one', async () => {
  const { zai } = await import('../../src/host/sources/zai.ts')
  let call = 0
  const fetch: FetchLike = async () => {
    call += 1
    if (call === 1) throw new TypeError('fetch failed')
    return { ok: true, status: 200, json: async () => ({ code: 1000, msg: 'Authentication Failed', success: false }) }
  }

  await assert.rejects(
    () => readUsage({ source: zai, mode: 'coding-plan', apiKey: 'k' }, { fetch }),
    (error: unknown) => error instanceof SourceError && error.kind === 'auth' && error.message === 'Authentication Failed',
  )
})

test('readUsage does not fall through when the user pinned the endpoint', async () => {
  const { zai } = await import('../../src/host/sources/zai.ts')
  const urls: string[] = []
  const fetch: FetchLike = async url => {
    urls.push(url)
    return { ok: true, status: 200, json: async () => ({ code: 1000, msg: 'Authentication Failed', success: false }) }
  }

  await assert.rejects(() =>
    readUsage(
      { source: zai, mode: 'coding-plan', apiKey: 'k', baseUrl: 'https://api.z.ai', pinnedBaseUrl: true },
      { fetch },
    ),
  )
  assert.deepEqual(urls, ['https://api.z.ai/api/monitor/usage/quota/limit'])
})

test('a provider-declared endpoint is used first, with the mirror still available', async () => {
  const { zai } = await import('../../src/host/sources/zai.ts')
  const urls: string[] = []
  const fetch: FetchLike = async url => {
    urls.push(url)
    return { ok: true, status: 200, json: async () => ({ code: 1000, msg: 'Authentication Failed', success: false }) }
  }

  await assert.rejects(() =>
    readUsage({ source: zai, mode: 'coding-plan', apiKey: 'k', baseUrl: 'https://api.z.ai' }, { fetch }),
  )
  assert.deepEqual(urls, [
    'https://api.z.ai/api/monitor/usage/quota/limit',
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
  ])
})
