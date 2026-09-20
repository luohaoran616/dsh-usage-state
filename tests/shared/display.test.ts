import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_CONFIG } from '../../src/shared/config.ts'
import {
  describeStatus,
  formatAge,
  formatBalance,
  formatCountdown,
  formatPercent,
  progressBar,
  severityOf,
  type SourceCatalog,
} from '../../src/shared/display.ts'
import type { UsageStateConfig } from '../../src/shared/config.ts'
import type { UsageSnapshot } from '../../src/shared/types.ts'

function configWith(models: UsageStateConfig['models']): UsageStateConfig {
  return { ...DEFAULT_CONFIG, models }
}

test('formatBalance renders the currency symbol for the currencies we know', () => {
  assert.equal(formatBalance({ amount: 66.28, currency: 'CNY' }), '¥66.28')
  assert.equal(formatBalance({ amount: 6.8, currency: 'USD' }), '$6.80')
  assert.equal(formatBalance({ amount: 0, currency: 'CNY' }), '¥0.00')
  assert.equal(formatBalance({ amount: 1.5, currency: 'EUR' }), 'EUR 1.50')
  assert.equal(formatBalance({ amount: 1.5, currency: '' }), '1.50')
})

test('formatPercent shows one decimal only when it carries information', () => {
  assert.equal(formatPercent(42), '42%')
  assert.equal(formatPercent(42.5), '42.5%')
  assert.equal(formatPercent(0), '0%')
  assert.equal(formatPercent(100), '100%')
})

test('formatCountdown scales from seconds to days and reports a passed reset as 0', () => {
  const now = 1_000_000_000_000
  assert.equal(formatCountdown(now + 45_000, now), '45s')
  assert.equal(formatCountdown(now + 12 * 60_000, now), '12m')
  assert.equal(formatCountdown(now + (4 * 60 + 12) * 60_000, now), '4h12m')
  assert.equal(formatCountdown(now + (3 * 24 + 4) * 3600_000, now), '3d4h')
  assert.equal(formatCountdown(now + 5 * 24 * 3600_000, now), '5d')
  assert.equal(formatCountdown(now - 1, now), '0s')
  assert.equal(formatCountdown(undefined, now), undefined)
})

test('formatAge reports how old a kept reading is', () => {
  const now = 1_000_000_000_000
  assert.equal(formatAge(now - 45_000, now), '45s')
  assert.equal(formatAge(now - 12 * 60_000, now), '12m')
  assert.equal(formatAge(now - (4 * 60 + 12) * 60_000, now), '4h12m')
  assert.equal(formatAge(now - 3 * 24 * 3600_000, now), '3d')
})

test('progressBar fills proportionally and respects its width', () => {
  assert.equal(progressBar(0, 4), '░░░░')
  assert.equal(progressBar(50, 4), '██░░')
  assert.equal(progressBar(100, 4), '████')
  assert.equal(progressBar(150, 4), '████')
  assert.equal(progressBar(42), '███░░░░░')
})

test('severityOf uses the configured thresholds', () => {
  assert.equal(severityOf(0, DEFAULT_CONFIG.display), 'normal')
  assert.equal(severityOf(79.9, DEFAULT_CONFIG.display), 'normal')
  assert.equal(severityOf(80, DEFAULT_CONFIG.display), 'warn')
  assert.equal(severityOf(94.9, DEFAULT_CONFIG.display), 'warn')
  assert.equal(severityOf(95, DEFAULT_CONFIG.display), 'critical')
  assert.equal(severityOf(100, DEFAULT_CONFIG.display), 'critical')
})

const SNAPSHOT: UsageSnapshot = {
  sourceId: 'kimi',
  mode: 'coding-plan',
  balances: [],
  windows: [
    { id: '5h', usedPercent: 42, resetsAt: 1_000_000_000_000 + 4 * 3600_000 },
    { id: '7d', usedPercent: 96 },
  ],
  fetchedAt: 1_000_000_000_000,
}

test('describeStatus renders nothing for a hidden model', () => {
  const segments = describeStatus({
    sourceLabel: 'Kimi / Moonshot',
    status: { kind: 'hidden' },
    snapshot: SNAPSHOT,
    display: DEFAULT_CONFIG.display,
    now: 1_000_000_000_000,
  })

  assert.deepEqual(segments, [])
})

test('describeStatus reports the states the UI has to explain', () => {
  const base = {
    sourceLabel: 'DeepSeek',
    snapshot: undefined,
    display: DEFAULT_CONFIG.display,
    now: 0,
  }

  assert.deepEqual(describeStatus({ ...base, status: { kind: 'unconfigured' } }), [
    { kind: 'state', state: 'unconfigured' },
  ])
  assert.deepEqual(describeStatus({ ...base, status: { kind: 'unsupported' } }), [{ kind: 'state', state: 'unsupported' }])
  assert.deepEqual(describeStatus({ ...base, status: { kind: 'needs-endpoint' } }), [
    { kind: 'state', state: 'needs-endpoint' },
  ])
  assert.deepEqual(
    describeStatus({ ...base, status: { kind: 'ready', key: 'deepseek:api', sourceId: 'deepseek', mode: 'api' } }),
    [{ kind: 'label', text: 'DeepSeek' }, { kind: 'state', state: 'loading' }],
  )
})

test('describeStatus surfaces an error when there is nothing to fall back on', () => {
  const segments = describeStatus({
    sourceLabel: 'DeepSeek',
    status: { kind: 'ready', key: 'deepseek:api', sourceId: 'deepseek', mode: 'api' },
    snapshot: {
      sourceId: 'deepseek',
      mode: 'api',
      balances: [],
      windows: [],
      fetchedAt: 1_000,
      error: { kind: 'auth', detail: 'HTTP 401' },
    },
    display: DEFAULT_CONFIG.display,
    now: 1_000,
  })

  assert.deepEqual(segments, [
    { kind: 'label', text: 'DeepSeek' },
    // The raw provider text rides along for the tooltip; the label stays localized.
    { kind: 'state', state: 'error', errorKind: 'auth', errorDetail: 'HTTP 401' },
  ])
})

test('describeStatus keeps a stale reading visible and marks it stale', () => {
  const segments = describeStatus({
    sourceLabel: 'DeepSeek',
    status: { kind: 'ready', key: 'deepseek:api', sourceId: 'deepseek', mode: 'api' },
    snapshot: {
      sourceId: 'deepseek',
      mode: 'api',
      balances: [{ amount: 66.28, currency: 'CNY' }],
      windows: [],
      fetchedAt: 1_000,
      stale: true,
      error: { kind: 'network', detail: 'offline' },
    },
    display: DEFAULT_CONFIG.display,
    now: 5_000,
  })

  assert.deepEqual(segments, [
    { kind: 'label', text: 'DeepSeek', stale: true, staleSince: 1_000 },
    { kind: 'balance', amount: '¥66.28', currency: 'CNY' },
  ])
})

test('describeStatus renders balance and quota modes with severity and reset times', () => {
  const balanceSegments = describeStatus({
    sourceLabel: 'DeepSeek',
    status: { kind: 'ready', key: 'deepseek:api', sourceId: 'deepseek', mode: 'api' },
    snapshot: { sourceId: 'deepseek', mode: 'api', balances: [{ amount: 66.28, currency: 'CNY' }], windows: [], fetchedAt: 1_000 },
    display: DEFAULT_CONFIG.display,
    now: 1_000,
  })
  assert.deepEqual(balanceSegments, [
    { kind: 'label', text: 'DeepSeek' },
    { kind: 'balance', amount: '¥66.28', currency: 'CNY' },
  ])

  const quotaSegments = describeStatus({
    sourceLabel: 'Kimi / Moonshot',
    status: { kind: 'ready', key: 'kimi:coding-plan', sourceId: 'kimi', mode: 'coding-plan' },
    snapshot: SNAPSHOT,
    display: DEFAULT_CONFIG.display,
    now: 1_000_000_000_000,
  })
  assert.deepEqual(quotaSegments, [
    { kind: 'label', text: 'Kimi / Moonshot' },
    {
      kind: 'window',
      windowId: '5h',
      percent: '42%',
      severity: 'normal',
      resetsAt: 1_000_000_000_000 + 4 * 3600_000,
      bar: '███░░░░░',
    },
    { kind: 'window', windowId: '7d', percent: '96%', severity: 'critical', bar: '████████' },
  ])
})

test('describeStatus hides the progress bar when the user turned it off', () => {
  const on = describeStatus({
    sourceLabel: 'Kimi',
    status: { kind: 'ready', key: 'kimi:coding-plan', sourceId: 'kimi', mode: 'coding-plan' },
    snapshot: SNAPSHOT,
    display: { ...DEFAULT_CONFIG.display, progressBar: true },
    now: 0,
  })
  const off = describeStatus({
    sourceLabel: 'Kimi',
    status: { kind: 'ready', key: 'kimi:coding-plan', sourceId: 'kimi', mode: 'coding-plan' },
    snapshot: SNAPSHOT,
    display: { ...DEFAULT_CONFIG.display, progressBar: false },
    now: 0,
  })

  const windowOn = on[1]
  const windowOff = off[1]
  assert.equal(windowOn?.kind === 'window' && windowOn.bar?.length, 8)
  assert.equal(windowOff?.kind === 'window' && windowOff.bar, undefined)
})
