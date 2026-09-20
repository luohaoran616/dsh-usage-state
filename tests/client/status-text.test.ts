import test from 'node:test'
import assert from 'node:assert/strict'

import { partsToText, statusParts, windowLabel, type Translate } from '../../src/client/status-text.ts'
import { en } from '../../src/client/locales.ts'
import type { StatusSegment } from '../../src/shared/display.ts'

/** A translate function shaped like the platform's: missing keys come back verbatim. */
const t: Translate = (key, params) => {
  let text = (en as Record<string, string>)[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

const NOW = 1_000_000_000_000

test('windowLabel prefers the dictionary and falls back to the raw id', () => {
  assert.equal(windowLabel('5h', t), '5h')
  assert.equal(windowLabel('9h', t), '9h')
})

test('an empty segment list renders nothing (a hidden model)', () => {
  assert.deepEqual(statusParts({ segments: [], t, now: NOW }), [])
  assert.equal(partsToText([]), '')
})

test('the parts of a quota line carry the label, percentages and countdown', () => {
  const segments: StatusSegment[] = [
    { kind: 'label', text: 'z.ai / GLM' },
    { kind: 'window', windowId: '5h', percent: '42%', severity: 'normal', resetsAt: NOW + 4 * 3600_000, bar: '███░░░░░' },
    { kind: 'window', windowId: '7d', percent: '96%', severity: 'critical', bar: '████████' },
  ]

  const parts = statusParts({ segments, t, now: NOW })

  assert.deepEqual(parts, [
    { kind: 'label', text: 'z.ai / GLM', stale: false },
    { kind: 'window', id: '5h', text: '5h 42%', percent: '42%', severity: 'normal', countdown: '4h0m', bar: '███░░░░░' },
    { kind: 'window', id: '7d', text: '7d 96%', percent: '96%', severity: 'critical', bar: '████████' },
  ])
  assert.equal(partsToText(parts), 'z.ai / GLM · 5h 42% (4h0m) · 7d 96%')
})

test('a stale balance line is flagged and says how old the value is', () => {
  const parts = statusParts({
    segments: [
      { kind: 'label', text: 'DeepSeek', stale: true, staleSince: NOW - 12 * 60_000 },
      { kind: 'balance', amount: '¥66.28', currency: 'CNY' },
    ],
    t,
    now: NOW,
  })

  assert.deepEqual(parts, [
    { kind: 'label', text: 'DeepSeek', stale: true },
    { kind: 'age', text: '12m ago' },
    { kind: 'balance', text: '¥66.28', currency: 'CNY' },
  ])
  assert.equal(partsToText(parts), 'DeepSeek · 12m ago · ¥66.28')
})

test('state segments are translated and keep the failure kind for a tooltip', () => {
  const states: StatusSegment[] = [
    { kind: 'state', state: 'unconfigured' },
    { kind: 'state', state: 'unsupported' },
    { kind: 'state', state: 'loading' },
    { kind: 'state', state: 'error', errorKind: 'auth' },
  ]

  const parts = statusParts({ segments: states, t, now: NOW })

  assert.deepEqual(parts, [
    { kind: 'state', state: 'unconfigured', text: 'Not configured' },
    { kind: 'state', state: 'unsupported', text: 'Mode not supported' },
    { kind: 'state', state: 'loading', text: 'Reading…' },
    { kind: 'state', state: 'error', text: 'Unavailable', errorKind: 'auth' },
  ])
})
