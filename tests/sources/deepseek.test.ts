import test from 'node:test'
import assert from 'node:assert/strict'

import { deepseek } from '../../src/host/sources/deepseek.ts'
import { SourceError } from '../../src/host/sources/types.ts'

const officialPayload = {
  is_available: true,
  balance_infos: [
    {
      currency: 'CNY',
      total_balance: '66.28',
      granted_balance: '0.00',
      topped_up_balance: '66.28',
    },
  ],
}

test('deepseek declares API mode only (the official API has no coding plan)', () => {
  assert.deepEqual([...deepseek.modes], ['api'])
  assert.deepEqual([...deepseek.credentialRefs], ['DEEPSEEK_API_KEY'])
  assert.equal(deepseek.defaultBaseUrl, 'https://api.deepseek.com')
})

test('deepseek builds an authenticated balance request', () => {
  const request = deepseek.request({ mode: 'api', apiKey: 'sk-test' })

  assert.equal(request.url, 'https://api.deepseek.com/user/balance')
  assert.equal(request.headers.authorization, 'Bearer sk-test')
})

test('deepseek honours a base URL override, including a /v1 suffix', () => {
  const request = deepseek.request({ mode: 'api', apiKey: 'sk-test', baseUrl: 'https://relay.example.com/v1/' })

  assert.equal(request.url, 'https://relay.example.com/user/balance')
})

test('deepseek parses the official balance payload', () => {
  const reading = deepseek.parse(officialPayload, 'api')

  assert.deepEqual(reading.balances, [{ amount: 66.28, currency: 'CNY' }])
  assert.deepEqual(reading.windows, [])
})

test('deepseek prefers the funded entry when currencies come back in either order', () => {
  const zeroCny = { currency: 'CNY', total_balance: '0.00' }
  const fundedUsd = { currency: 'USD', total_balance: '12.34' }

  for (const infos of [
    [zeroCny, fundedUsd],
    [fundedUsd, zeroCny],
  ]) {
    const reading = deepseek.parse({ balance_infos: infos }, 'api')
    assert.deepEqual(reading.balances, [{ amount: 12.34, currency: 'USD' }])
  }
})

test('deepseek prefers CNY when every currency is zero', () => {
  const reading = deepseek.parse(
    {
      balance_infos: [
        { currency: 'USD', total_balance: '0.00' },
        { currency: 'CNY', total_balance: '0' },
      ],
    },
    'api',
  )

  assert.deepEqual(reading.balances, [{ amount: 0, currency: 'CNY' }])
})

test('deepseek falls back to the first entry when CNY is absent', () => {
  const reading = deepseek.parse({ balance_infos: [{ currency: 'USD', total_balance: 3 }] }, 'api')

  assert.deepEqual(reading.balances, [{ amount: 3, currency: 'USD' }])
})

test('deepseek treats a missing or empty amount as zero rather than failing', () => {
  const reading = deepseek.parse({ balance_infos: [{ currency: 'CNY' }, { currency: 'USD' }] }, 'api')

  assert.deepEqual(reading.balances, [{ amount: 0, currency: 'CNY' }])
})

test('deepseek rejects payloads without usable balance_infos', () => {
  for (const payload of [{}, { balance_infos: [] }, { balance_infos: 'nope' }, null, 'html']) {
    assert.throws(
      () => deepseek.parse(payload, 'api'),
      (error: unknown) => error instanceof SourceError && error.kind === 'parse',
      `expected a parse failure for ${JSON.stringify(payload)}`,
    )
  }
})

test('deepseek ignores blank currency codes without throwing', () => {
  const reading = deepseek.parse({ balance_infos: [{ total_balance: '1.5' }] }, 'api')

  assert.deepEqual(reading.balances, [{ amount: 1.5, currency: '' }])
})
