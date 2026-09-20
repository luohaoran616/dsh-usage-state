import test from 'node:test'
import assert from 'node:assert/strict'

import { compactParts, partsToText, statusParts, windowLabel, type Translate } from '../../src/client/status-text.ts'
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

  const parts = statusParts({ segments, t, now: NOW, sourceLabel: 'z.ai / GLM', modeLabel: 'Coding plan' })

  assert.equal(partsToText(parts), 'z.ai / GLM · 5h 42% (4h0m) · 7d 96%')
  assert.deepEqual(parts[0], {
    kind: 'label',
    text: 'z.ai / GLM',
    stale: false,
    tooltip: 'Source z.ai / GLM · Mode Coding plan',
  })
  // The window keeps the countdown on the line and the absolute reset in the tooltip.
  assert.deepEqual(parts[1]?.kind === 'window' ? parts[1].text : undefined, '5h 42%')
  assert.equal(parts[1]?.kind === 'window' ? parts[1].countdown : undefined, '4h0m')
  assert.match(parts[1]?.tooltip ?? '', /^Resets at /)
  assert.match(parts[1]?.tooltip ?? '', /Source z\.ai \/ GLM · Mode Coding plan$/)
  assert.deepEqual(parts[2]?.tooltip, 'Source z.ai / GLM · Mode Coding plan')
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

  assert.deepEqual(parts[0], {
    kind: 'label',
    text: 'DeepSeek',
    stale: true,
    tooltip: 'Showing the last value that was fetched successfully · Last successful update 12m ago',
  })
  assert.deepEqual(parts[1], {
    kind: 'age',
    text: '12m ago',
    tooltip: 'Showing the last value that was fetched successfully',
  })
  assert.deepEqual(parts[2], { kind: 'balance', text: '¥66.28', currency: 'CNY' })
  assert.equal(partsToText(parts), 'DeepSeek · 12m ago · ¥66.28')
})

test('state segments are translated and explain themselves in the tooltip', () => {
  const states: StatusSegment[] = [
    { kind: 'state', state: 'unconfigured' },
    { kind: 'state', state: 'unsupported' },
    { kind: 'state', state: 'loading' },
    { kind: 'state', state: 'error', errorKind: 'auth', errorDetail: 'HTTP 401' },
  ]

  const parts = statusParts({ segments: states, t, now: NOW, sourceLabel: 'DeepSeek', modeLabel: 'API balance' })

  assert.deepEqual(
    parts.map(part => part.text),
    ['Not configured', 'Mode not supported', 'Reading…', 'Unavailable'],
  )
  assert.deepEqual(parts[0]?.tooltip, 'Source DeepSeek · Mode API balance')
  // The real reason must survive into the tooltip, detail included.
  assert.equal(parts[3]?.kind === 'state' ? parts[3].errorKind : undefined, 'auth')
  assert.equal(parts[3]?.tooltip, 'Key rejected: HTTP 401 · Source DeepSeek · Mode API balance')
})

test('a balance tooltip carries the provider split when the endpoint reports one', () => {
  const parts = statusParts({
    segments: [{ kind: 'balance', amount: '¥58.13', currency: 'CNY', granted: 0, toppedUp: 58.13 }],
    t,
    now: NOW,
    sourceLabel: 'DeepSeek',
    modeLabel: 'API balance',
  })

  assert.equal(parts[0]?.tooltip, 'Granted 0 · Topped up 58.13 · Source DeepSeek · Mode API balance')
})

test('compactParts drops the label and the age to fit the action strip', () => {
  const parts = statusParts({
    segments: [
      { kind: 'label', text: 'z.ai / GLM' },
      { kind: 'window', windowId: '5h', percent: '42%', severity: 'normal', resetsAt: NOW + 4 * 3600_000, bar: '███░░░░░' },
      { kind: 'window', windowId: '7d', percent: '96%', severity: 'critical', bar: '████████' },
    ],
    t,
    now: NOW,
    sourceLabel: 'z.ai / GLM',
    modeLabel: 'Coding plan',
  })

  const compact = compactParts(parts)

  assert.deepEqual(
    compact.map(part => part.kind),
    ['window', 'window'],
  )
  // The strip has one line next to icons, so the countdown and bar move to the tooltip.
  assert.equal(compact[0]?.kind === 'window' ? compact[0].countdown : 'set', undefined)
  assert.equal(compact[0]?.kind === 'window' ? compact[0].bar : 'set', undefined)
  assert.equal(compact[0]?.kind === 'window' ? compact[0].text : undefined, '5h 42%')
  assert.equal(compact[0]?.kind === 'window' ? compact[0].severity : undefined, 'normal')
  // Details survive in the tooltip.
  assert.match(compact[0]?.tooltip ?? '', /Resets at /)
  assert.deepEqual(compact[1]?.tooltip, 'Source z.ai / GLM · Mode Coding plan')
})

test('compactParts keeps balances and state parts as they are', () => {
  const parts = statusParts({
    segments: [
      { kind: 'label', text: 'DeepSeek', stale: true, staleSince: NOW - 12 * 60_000 },
      { kind: 'balance', amount: '¥58.13', currency: 'CNY', granted: 0, toppedUp: 58.13 },
      { kind: 'state', state: 'error', errorKind: 'auth', errorDetail: 'HTTP 401' },
    ],
    t,
    now: NOW,
    sourceLabel: 'DeepSeek',
  })

  const compact = compactParts(parts)

  assert.deepEqual(
    compact.map(part => part.kind),
    ['balance', 'state'],
  )
  assert.equal(compact[0]?.text, '¥58.13')
  assert.equal(compact[1]?.text, 'Unavailable')
  assert.deepEqual(compactParts([]), [])
})
