import test from 'node:test'
import assert from 'node:assert/strict'

import { sub2api } from '../../src/host/sources/sub2api.ts'
import { SourceError } from '../../src/host/sources/types.ts'

const FIVE_H_RESET = '2026-09-20T16:00:00Z'
const WEEK_RESET = '2026-09-27T00:00:00Z'

const quotaLimitedPayload = {
  mode: 'quota_limited',
  isValid: true,
  status: 'active',
  quota: { limit: 10, used: 3.2, remaining: 6.8, unit: 'USD' },
  remaining: 6.8,
  unit: 'USD',
  rate_limits: [
    { window: '5h', limit: 5, used: 1.2, remaining: 3.8, window_start: '2026-09-20T11:00:00Z', reset_at: FIVE_H_RESET },
    { window: '7d', limit: 80, used: 22.5, remaining: 57.5, reset_at: WEEK_RESET },
  ],
  usage: { today: { requests: 0 }, rpm: 0, tpm: 0 },
}

test('sub2api serves both modes and requires a user-supplied endpoint', () => {
  assert.deepEqual([...sub2api.modes], ['api', 'coding-plan'])
  assert.equal(sub2api.requiresBaseUrl, true)
  assert.deepEqual([...sub2api.credentialRefs('api')], ['SUB2API_API_KEY'])
})

test('sub2api builds an authenticated /v1/usage request', () => {
  const request = sub2api.request({ mode: 'api', apiKey: 'sk-abc', baseUrl: 'https://gw.example.com/' })

  assert.equal(request.url, 'https://gw.example.com/v1/usage')
  assert.equal(request.headers.authorization, 'Bearer sk-abc')
})

test('sub2api refuses to build a request without an endpoint', () => {
  for (const baseUrl of [undefined, '', '   ']) {
    assert.throws(
      () => sub2api.request({ mode: 'api', apiKey: 'sk-abc', baseUrl }),
      (error: unknown) => error instanceof SourceError && error.kind === 'config',
    )
  }
})

test('sub2api reads the key quota as a USD balance and the rate-limit windows as quotas', () => {
  const reading = sub2api.parse(quotaLimitedPayload, 'coding-plan')

  assert.deepEqual(reading.balances, [{ amount: 6.8, currency: 'USD' }])
  assert.deepEqual(reading.windows, [
    { id: '5h', usedPercent: 24, resetsAt: Date.parse(FIVE_H_RESET) },
    { id: '7d', usedPercent: 28.1, resetsAt: Date.parse(WEEK_RESET) },
  ])
})

test('sub2api omits windows without a positive limit and tolerates a missing reset time', () => {
  const reading = sub2api.parse(
    {
      mode: 'quota_limited',
      quota: { limit: 0, used: 0, remaining: 0, unit: 'USD' },
      rate_limits: [
        { window: '5h', limit: 0, used: 0, remaining: 0 },
        { window: '1d', limit: 20, used: 5, remaining: 15 },
        { window: '5h', limit: 0 },
        'garbage',
      ],
    },
    'coding-plan',
  )

  assert.deepEqual(reading.windows, [{ id: '1d', usedPercent: 25 }])
})

test('sub2api reads the wallet balance of an unrestricted key', () => {
  const reading = sub2api.parse(
    { mode: 'unrestricted', isValid: true, planName: '钱包余额', remaining: 66.28, unit: 'USD', balance: 66.28 },
    'api',
  )

  assert.deepEqual(reading.balances, [{ amount: 66.28, currency: 'USD' }])
  assert.deepEqual(reading.windows, [])
})

test('sub2api maps subscription limits onto 1d / 7d / 30d windows', () => {
  const reading = sub2api.parse(
    {
      mode: 'unrestricted',
      unit: 'USD',
      remaining: 12.5,
      subscription: {
        daily_usage_usd: 1,
        daily_limit_usd: 5,
        weekly_usage_usd: 5,
        weekly_limit_usd: 25,
        monthly_usage_usd: 12.5,
        monthly_limit_usd: 100,
        weekly_window_start: '2026-09-15T00:00:00Z',
        expires_at: '2026-10-20T00:00:00Z',
      },
    },
    'coding-plan',
  )

  assert.deepEqual(reading.windows, [
    { id: '1d', usedPercent: 20 },
    { id: '7d', usedPercent: 20 },
    { id: '30d', usedPercent: 12.5 },
  ])
})

test('sub2api skips null subscription limits and does not surface the -1 "unlimited" remaining', () => {
  const reading = sub2api.parse(
    {
      mode: 'unrestricted',
      unit: 'USD',
      remaining: -1,
      subscription: { daily_usage_usd: 2, daily_limit_usd: null, weekly_usage_usd: 5, weekly_limit_usd: 25 },
    },
    'coding-plan',
  )

  assert.deepEqual(reading.balances, [])
  assert.deepEqual(reading.windows, [{ id: '7d', usedPercent: 20 }])
})

test('sub2api rejects a subscription key with neither subscription nor balance', () => {
  assert.throws(
    () => sub2api.parse({ mode: 'unrestricted', isValid: true, planName: 'x' }, 'coding-plan'),
    (error: unknown) => error instanceof SourceError && error.kind === 'parse',
  )
})

test('sub2api rejects payloads that are not usage objects', () => {
  for (const payload of [null, 'nope', [], {}, { mode: 'quota_limited' }]) {
    assert.throws(
      () => sub2api.parse(payload, 'api'),
      (error: unknown) => error instanceof SourceError && error.kind === 'parse',
      `expected a parse failure for ${JSON.stringify(payload)}`,
    )
  }
})

test('sub2api falls back to USD when the unit is missing', () => {
  const reading = sub2api.parse({ mode: 'unrestricted', balance: 3 }, 'api')

  assert.deepEqual(reading.balances, [{ amount: 3, currency: 'USD' }])
})
