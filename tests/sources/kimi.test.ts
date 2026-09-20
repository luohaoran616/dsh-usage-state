import test from 'node:test'
import assert from 'node:assert/strict'

import { kimi } from '../../src/host/sources/kimi.ts'
import { SourceError } from '../../src/host/sources/types.ts'

const FIVE_H_RESET = '2026-09-20T16:00:00.000Z'
const WEEK_RESET = '2026-09-27T00:00:00.000Z'

test('kimi serves both modes with different endpoints and credentials', () => {
  assert.deepEqual([...kimi.modes], ['api', 'coding-plan'])
  assert.equal(kimi.defaultBaseUrl('api'), 'https://api.moonshot.cn')
  assert.equal(kimi.defaultBaseUrl('coding-plan'), 'https://api.kimi.com')
  assert.ok(kimi.credentialRefs('coding-plan').includes('KIMI_CODING_API_KEY'))
  assert.ok(kimi.credentialRefs('api').includes('MOONSHOT_API_KEY'))
  assert.ok(!kimi.credentialRefs('api').includes('KIMI_CODING_API_KEY'))
})

test('kimi reads the Moonshot pay-as-you-go balance in API mode', () => {
  const request = kimi.request({ mode: 'api', apiKey: 'sk-moonshot' })

  assert.equal(request.url, 'https://api.moonshot.cn/v1/users/me/balance')
  assert.equal(request.headers.authorization, 'Bearer sk-moonshot')
})

test('kimi reads the Kimi Code subscription windows in coding-plan mode, with the CLI user agent', () => {
  const request = kimi.request({ mode: 'coding-plan', apiKey: 'sk-kimi' })

  assert.equal(request.url, 'https://api.kimi.com/coding/v1/usages')
  assert.equal(request.headers.authorization, 'Bearer sk-kimi')
  assert.equal(request.headers['user-agent'], 'KimiCLI/1.6')
})

test('kimi parses the weekly window from the top-level usage and the 5h window from limits[]', () => {
  const reading = kimi.parse(
    {
      usage: { used: 30, limit: 100, remaining: 70, resetTime: WEEK_RESET },
      limits: [
        { window: { duration: 5, timeUnit: 'hour' }, detail: { used: 12, limit: 60, remaining: 48, resetTime: FIVE_H_RESET } },
      ],
    },
    'coding-plan',
  )

  assert.deepEqual(reading.windows, [
    { id: '5h', usedPercent: 20, resetsAt: Date.parse(FIVE_H_RESET) },
    { id: '7d', usedPercent: 30, resetsAt: Date.parse(WEEK_RESET) },
  ])
  assert.deepEqual(reading.balances, [])
})

test('kimi derives the percentage from remaining when used is absent', () => {
  const reading = kimi.parse(
    { usage: { limit: 200, remaining: 150 }, limits: [{ window: { duration: 5, timeUnit: 'hour' }, detail: { limit: 40, remaining: 30 } }] },
    'coding-plan',
  )

  assert.deepEqual(reading.windows, [
    { id: '5h', usedPercent: 25 },
    { id: '7d', usedPercent: 25 },
  ])
})

test('kimi ignores limit rows without a usable detail window', () => {
  const reading = kimi.parse(
    { usage: { used: 1, limit: 4 }, limits: [{ window: { duration: 5, timeUnit: 'hour' } }, null, 'x'] },
    'coding-plan',
  )

  assert.deepEqual(reading.windows, [{ id: '7d', usedPercent: 25 }])
})

test('kimi reads the Moonshot balance, treating cent amounts as cents and small amounts as yuan', () => {
  assert.deepEqual(kimi.parse({ available_balance: 6628 }, 'api').balances, [{ amount: 66.28, currency: 'CNY' }])
  assert.deepEqual(kimi.parse({ available_balance: 66.28 }, 'api').balances, [{ amount: 66.28, currency: 'CNY' }])
  assert.deepEqual(kimi.parse({ data: { available_balance: 1200 } }, 'api').balances, [{ amount: 12, currency: 'CNY' }])
  assert.deepEqual(kimi.parse({ balance: 350 }, 'api').balances, [{ amount: 3.5, currency: 'CNY' }])
})

test('kimi rejects payloads it cannot read in either mode', () => {
  for (const payload of [{}, { usage: {} }, null, 'nope']) {
    assert.throws(
      () => kimi.parse(payload, 'coding-plan'),
      (error: unknown) => error instanceof SourceError && error.kind === 'parse',
      `expected a coding-plan parse failure for ${JSON.stringify(payload)}`,
    )
  }
  for (const payload of [{}, { available_balance: 'nope' }, { available_balance: -1 }, null]) {
    assert.throws(
      () => kimi.parse(payload, 'api'),
      (error: unknown) => error instanceof SourceError && error.kind === 'parse',
      `expected an api parse failure for ${JSON.stringify(payload)}`,
    )
  }
})
