import test from 'node:test'
import assert from 'node:assert/strict'

import { SourceError } from '../../src/host/sources/types.ts'
import { zai } from '../../src/host/sources/zai.ts'

const FIVE_H_RESET = Date.UTC(2026, 8, 20, 16, 0, 0)
const WEEK_RESET = Date.UTC(2026, 8, 27, 0, 0, 0)

const monitorPayload = {
  success: true,
  data: {
    level: 'pro',
    limits: [
      {
        type: 'TOKENS_LIMIT',
        unit: 3,
        number: 5,
        usage: 100_000,
        currentValue: 42_000,
        remaining: 58_000,
        percentage: 42,
        nextResetTime: FIVE_H_RESET,
      },
      {
        type: 'TOKENS_LIMIT',
        unit: 6,
        number: 1,
        usage: 1_000_000,
        currentValue: 180_000,
        remaining: 820_000,
        percentage: 18,
        nextResetTime: WEEK_RESET,
      },
    ],
  },
}

test('zai offers coding-plan mode only', () => {
  assert.deepEqual([...zai.modes], ['coding-plan'])
  assert.equal(zai.defaultBaseUrl('coding-plan'), 'https://api.z.ai')
})

test('zai builds an authenticated monitor request and honours a mirror override', () => {
  assert.equal(
    zai.request({ mode: 'coding-plan', apiKey: 'k' }).url,
    'https://api.z.ai/api/monitor/usage/quota/limit',
  )
  assert.equal(
    zai.request({ mode: 'coding-plan', apiKey: 'k', baseUrl: 'https://open.bigmodel.cn/' }).url,
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
  )
  assert.equal(zai.request({ mode: 'coding-plan', apiKey: 'k' }).headers.authorization, 'Bearer k')
})

test('zai maps unit 3 to the 5h window and unit 6 to the weekly window', () => {
  const reading = zai.parse(monitorPayload, 'coding-plan')

  assert.deepEqual(reading.windows, [
    { id: '5h', usedPercent: 42, resetsAt: FIVE_H_RESET },
    { id: '7d', usedPercent: 18, resetsAt: WEEK_RESET },
  ])
  assert.deepEqual(reading.balances, [])
})

test('zai accepts CREDIT_LIMIT (Lite plans) exactly like TOKENS_LIMIT', () => {
  const reading = zai.parse(
    {
      data: {
        limits: [{ type: 'CREDIT_LIMIT', unit: 3, number: 5, percentage: 7.5, nextResetTime: FIVE_H_RESET }],
      },
    },
    'coding-plan',
  )

  assert.deepEqual(reading.windows, [{ id: '5h', usedPercent: 7.5, resetsAt: FIVE_H_RESET }])
})

test('zai ignores TIME_LIMIT (monthly MCP budget, different unit)', () => {
  const reading = zai.parse(
    {
      data: {
        limits: [
          { type: 'TIME_LIMIT', unit: 1, number: 1, percentage: 90 },
          { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 12 },
        ],
      },
    },
    'coding-plan',
  )

  assert.deepEqual(reading.windows.map(window => window.id), ['5h'])
})

test('zai derives the percentage from currentValue/usage when percentage is absent', () => {
  const reading = zai.parse(
    { data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3, number: 5, usage: 200, currentValue: 50 }] } },
    'coding-plan',
  )

  assert.equal(reading.windows[0]?.usedPercent, 25)
})

test('zai reads `percentage` as an already-0..100 number, so 1 means one percent', () => {
  const reading = zai.parse(
    { data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 1 }] } },
    'coding-plan',
  )

  assert.equal(reading.windows[0]?.usedPercent, 1)
})

test('zai fills the 5h slot first when limits carry no unit', () => {
  const reading = zai.parse(
    {
      data: {
        limits: [
          { type: 'TOKENS_LIMIT', percentage: 0 },
          { type: 'TOKENS_LIMIT', percentage: 33, nextResetTime: WEEK_RESET },
        ],
      },
    },
    'coding-plan',
  )

  // A 0%-used rolling window reports no reset time; it sorts first and takes 5h.
  assert.deepEqual(reading.windows, [
    { id: '5h', usedPercent: 0 },
    { id: '7d', usedPercent: 33, resetsAt: WEEK_RESET },
  ])
})

test('zai falls back to the legacy plans shape, choosing the window by reset span', () => {
  const now = Date.now()
  const reading = zai.parse(
    {
      plans: [
        { status: 'active', total_units: 2000, used_units: 500, period_end: Math.floor((now + 3 * 3600_000) / 1000) },
        { status: 'active', total_units: 10_000, used_units: 2500, period_end: Math.floor((now + 5 * 86400_000) / 1000) },
      ],
    },
    'coding-plan',
  )

  assert.equal(reading.windows.length, 2)
  const fiveHour = reading.windows.find(window => window.id === '5h')
  const weekly = reading.windows.find(window => window.id === '7d')
  assert.equal(fiveHour?.usedPercent, 25)
  assert.equal(weekly?.usedPercent, 25)
  assert.ok((fiveHour?.resetsAt ?? 0) < (weekly?.resetsAt ?? 0))
})

test('zai falls back to a flat window object, treating utilization as a fraction or a percentage', () => {
  const reading = zai.parse(
    { five_hour: { utilization: 0.425, resets_at: FIVE_H_RESET }, weekly: { utilization: 18, resets_at: WEEK_RESET } },
    'coding-plan',
  )

  assert.deepEqual(reading.windows, [
    { id: '5h', usedPercent: 42.5, resetsAt: FIVE_H_RESET },
    { id: '7d', usedPercent: 18, resetsAt: WEEK_RESET },
  ])
})

test('zai rejects payloads that carry no usable window', () => {
  for (const payload of [{}, { data: { limits: [] } }, { data: { limits: [{ type: 'TIME_LIMIT', percentage: 5 }] } }, null, 'nope']) {
    assert.throws(
      () => zai.parse(payload, 'coding-plan'),
      (error: unknown) => error instanceof SourceError && error.kind === 'parse',
      `expected a parse failure for ${JSON.stringify(payload)}`,
    )
  }
})
