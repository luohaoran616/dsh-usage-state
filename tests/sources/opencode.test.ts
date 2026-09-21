import test from 'node:test'
import assert from 'node:assert/strict'

import { opencode } from '../../src/host/sources/opencode.ts'
import { SourceError } from '../../src/host/sources/types.ts'
import { readUsage, type FetchLike } from '../../src/host/read.ts'

test('opencode serves coding-plan only, from the opencode.ai origin', () => {
  assert.equal(opencode.id, 'opencode')
  assert.deepEqual([...opencode.modes], ['coding-plan'])
  assert.equal(opencode.defaultBaseUrl('coding-plan'), 'https://opencode.ai')
  assert.equal(opencode.requiresBaseUrl, undefined)
  assert.equal(opencode.requiresApiKey, undefined)
})

test('opencode probes the Go key before the general Zen key', () => {
  assert.deepEqual(opencode.credentialRefs('coding-plan'), ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'])
})

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

test('opencode requests the Go usage endpoint from an origin base', () => {
  assert.equal(opencode.request({ mode: 'coding-plan', apiKey: 'k' }).url, USAGE_URL)
  assert.equal(opencode.request({ mode: 'coding-plan', apiKey: 'k', baseUrl: 'https://opencode.ai/' }).url, USAGE_URL)
  assert.equal(opencode.request({ mode: 'coding-plan', apiKey: 'k', baseUrl: 'https://opencode.ai' }).url, USAGE_URL)
})

test('opencode does not double the /zen/go path when the endpoint arrived already suffixed', () => {
  // A provider profile declares `baseURL: https://opencode.ai/zen/go/v1`; the
  // settings page can also pin that same string. Both must land on one path.
  for (const baseUrl of [
    'https://opencode.ai/zen/go/v1',
    'https://opencode.ai/zen/go/v1/',
    'https://opencode.ai/zen/go',
    'https://opencode.ai/zen/go/v1/usage',
    'https://opencode.ai/zen/go/usage',
  ]) {
    assert.equal(opencode.request({ mode: 'coding-plan', apiKey: 'k', baseUrl }).url, USAGE_URL, baseUrl)
  }
  assert.equal(
    opencode.request({ mode: 'coding-plan', apiKey: 'k', baseUrl: 'https://opencode.ai/zen/go/v1', pinnedBaseUrl: true }).url,
    USAGE_URL,
  )
})

test('opencode normalizes every reset-time form, not just the ISO one it returns today', () => {
  const unixSeconds = 1_789_985_323
  const unixMillis = 1_789_985_323_776
  const cases: Array<[unknown, number]> = [
    ['2026-09-21T10:08:43.658Z', 1_789_985_323_658],
    [unixSeconds, unixSeconds * 1000],
    [unixMillis, unixMillis],
    [String(unixSeconds), unixSeconds * 1000],
  ]

  for (const [resetsAt, expected] of cases) {
    const reading = opencode.parse({ usage: { rolling: { percent: 1, resetsAt } } }, 'coding-plan')
    assert.equal(reading.windows[0]?.resetsAt, expected, `resetsAt ${String(resetsAt)}`)
  }

  // A nonsense instant is dropped rather than turned into a 1970 date.
  const noReset = opencode.parse({ usage: { rolling: { percent: 1, resetsAt: 'soon' } } }, 'coding-plan')
  assert.deepEqual(noReset.windows, [{ id: '5h', usedPercent: 1 }])
})

test('opencode sends a bearer token and a browser user agent (Cloudflare error 1010 without one)', () => {
  const headers = opencode.request({ mode: 'coding-plan', apiKey: 'sk-go' }).headers

  assert.equal(headers.authorization, 'Bearer sk-go')
  assert.equal(headers.accept, 'application/json')
  assert.match(headers['user-agent'] ?? '', /Mozilla\/5\.0/)
})

const FIVE_H_RESET = Date.UTC(2026, 8, 21, 10, 8, 43, 658)
const WEEK_RESET = Date.UTC(2026, 8, 28, 0, 0, 0, 658)
const MONTH_RESET = Date.UTC(2026, 9, 21, 3, 42, 7, 658)

/** A live `GET /zen/go/v1/usage` body (values changed). */
const livePayload = {
  usage: {
    rolling: { status: 'ok', percent: 42, resetsAt: '2026-09-21T10:08:43.658Z' },
    weekly: { status: 'ok', percent: 18, resetsAt: '2026-09-28T00:00:00.658Z' },
    monthly: { status: 'ok', percent: 7, resetsAt: '2026-10-21T03:42:07.658Z' },
  },
}

test('opencode maps rolling/weekly/monthly onto the canonical 5h/7d/30d windows', () => {
  assert.deepEqual(opencode.parse(livePayload, 'coding-plan'), {
    balances: [],
    windows: [
      { id: '5h', usedPercent: 42, resetsAt: FIVE_H_RESET },
      { id: '7d', usedPercent: 18, resetsAt: WEEK_RESET },
      { id: '30d', usedPercent: 7, resetsAt: MONTH_RESET },
    ],
  })
})

test('opencode reads percent as an already-0..100 percentage, including decimal and numeric-string forms', () => {
  const reading = opencode.parse(
    { usage: { rolling: { percent: 0.5 }, weekly: { percent: '18.25' }, monthly: { percent: 1 } } },
    'coding-plan',
  )

  // `percent` is a percentage, not a fraction: 0.5 is half a percent, and 1 is one percent.
  assert.deepEqual(reading.windows, [
    { id: '5h', usedPercent: 0.5 },
    { id: '7d', usedPercent: 18.3 },
    { id: '30d', usedPercent: 1 },
  ])
})

test('opencode skips a window whose percent is unreadable, without inventing a value', () => {
  const reading = opencode.parse(
    { usage: { rolling: { percent: 42 }, weekly: { percent: null }, monthly: { percent: 'n/a' } } },
    'coding-plan',
  )

  // A malformed window is dropped rather than reported as 0% used.
  assert.deepEqual(reading.windows, [{ id: '5h', usedPercent: 42 }])
})

test('opencode accepts the documented data.usage envelope as well as the live root-level usage object', () => {
  const reading = opencode.parse(
    { data: { usage: { rolling: { status: 'ok', percent: 42, resetsAt: '2026-09-21T10:08:43.658Z' } } } },
    'coding-plan',
  )

  assert.deepEqual(reading.windows, [{ id: '5h', usedPercent: 42, resetsAt: FIVE_H_RESET }])
})

test('opencode refuses a payload that carries no usable window', () => {
  for (const payload of [
    {},
    { usage: {} },
    { usage: { rolling: {} } },
    { usage: { rolling: { percent: null } } },
    { usage: [] },
    { usage: 'ok' },
    null,
    'nope',
  ]) {
    assert.throws(
      () => opencode.parse(payload, 'coding-plan'),
      error => error instanceof SourceError && error.kind === 'parse',
      `expected a parse failure for ${JSON.stringify(payload)}`,
    )
  }
})

test('readUsage sends exactly one browser-UA request and yields 5h/7d/30d', async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers })
    return { ok: true, status: 200, json: async () => livePayload }
  }

  const reading = await readUsage({ source: opencode, mode: 'coding-plan', apiKey: 'sk-go' }, { fetch })

  assert.deepEqual(calls.map(call => call.url), [USAGE_URL])
  assert.match(calls[0]?.headers['user-agent'] ?? '', /Mozilla\/5\.0/)
  assert.deepEqual(reading.windows.map(window => window.id), ['5h', '7d', '30d'])
})

test('a rejected or unsubscribed key is an auth failure, never a 0% reading', async () => {
  for (const status of [401, 403]) {
    const fetch: FetchLike = async () => ({
      ok: false,
      status,
      json: async () => ({ type: 'error', error: { type: 'AuthError', message: 'Unauthorized' } }),
    })

    await assert.rejects(
      () => readUsage({ source: opencode, mode: 'coding-plan', apiKey: 'sk-bogus' }, { fetch }),
      error => error instanceof SourceError && error.kind === 'auth' && error.message === `HTTP ${status}`,
      `expected HTTP ${status} to become an auth failure`,
    )
  }
})
