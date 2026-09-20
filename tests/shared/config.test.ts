import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_CONFIG, normalizeConfig } from '../../src/shared/config.ts'

test('the default config carries no provider overrides and no stored order', () => {
  assert.deepEqual(DEFAULT_CONFIG.providers, {})
  assert.deepEqual(DEFAULT_CONFIG.order, [])
})

test('normalizeConfig returns the defaults for anything that is not a section object', () => {
  for (const raw of [undefined, null, 'nope', 42, [], true]) {
    assert.deepEqual(normalizeConfig(raw), DEFAULT_CONFIG, `expected defaults for ${JSON.stringify(raw)}`)
  }
})

test('normalizeConfig fills missing fields from the defaults', () => {
  assert.deepEqual(normalizeConfig({}), DEFAULT_CONFIG)
  assert.deepEqual(normalizeConfig({ refresh: {} }).refresh, DEFAULT_CONFIG.refresh)
  assert.deepEqual(normalizeConfig({ display: {} }).display, DEFAULT_CONFIG.display)
})

test('normalizeConfig keeps well-formed model entries in order', () => {
  const config = normalizeConfig({
    models: [
      { provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'api' },
      { provider: 'zai', model: 'glm-4.6', sourceId: 'zai', mode: 'coding-plan' },
    ],
  })

  assert.deepEqual(config.models, [
    { provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'api' },
    { provider: 'zai', model: 'glm-4.6', sourceId: 'zai', mode: 'coding-plan' },
  ])
})

test('normalizeConfig drops model entries that cannot be identified', () => {
  const config = normalizeConfig({
    models: [
      { provider: 'p', model: 'm', sourceId: 'deepseek', mode: 'api' },
      { provider: '', model: 'm', sourceId: 'deepseek', mode: 'api' },
      { provider: 'p' },
      'garbage',
      null,
      { provider: 42, model: 'm' },
    ],
  })

  assert.deepEqual(config.models, [{ provider: 'p', model: 'm', sourceId: 'deepseek', mode: 'api' }])
})

test('normalizeConfig hides a model whose mode is unreadable, and unconfigures a bad source id', () => {
  const config = normalizeConfig({
    models: [
      { provider: 'p', model: 'a', sourceId: 'deepseek', mode: 'nonsense' },
      { provider: 'p', model: 'b', sourceId: 42, mode: 'api' },
      { provider: 'p', model: 'c', mode: 'coding-plan' },
    ],
  })

  assert.deepEqual(config.models, [
    { provider: 'p', model: 'a', sourceId: 'deepseek', mode: 'hidden' },
    { provider: 'p', model: 'b', sourceId: null, mode: 'api' },
    { provider: 'p', model: 'c', sourceId: null, mode: 'coding-plan' },
  ])
})

test('normalizeConfig keeps the first entry when the same model appears twice', () => {
  const config = normalizeConfig({
    models: [
      { provider: 'p', model: 'm', sourceId: 'deepseek', mode: 'api' },
      { provider: 'p', model: 'm', sourceId: 'zai', mode: 'coding-plan' },
    ],
  })

  assert.deepEqual(config.models, [{ provider: 'p', model: 'm', sourceId: 'deepseek', mode: 'api' }])
})

test('normalizeConfig trims source overrides and drops entries that carry nothing', () => {
  const config = normalizeConfig({
    sources: {
      zai: { baseUrl: '  https://open.bigmodel.cn  ', apiKeyRef: ' GLM_KEY ' },
      kimi: { baseUrl: '' },
      sub2api: {},
      ghost: 'nope',
    },
  })

  assert.deepEqual(config.sources, {
    zai: { baseUrl: 'https://open.bigmodel.cn', apiKeyRef: 'GLM_KEY' },
  })
})

test('normalizeConfig clamps the refresh policy into sane ranges', () => {
  assert.deepEqual(normalizeConfig({ refresh: { intervalMinutes: 9999, turnEndDelayMs: -5, minIntervalSeconds: 1e9 } }).refresh, {
    intervalMinutes: 1440,
    turnEndDelayMs: 0,
    minIntervalSeconds: 3600,
  })
  assert.deepEqual(normalizeConfig({ refresh: { intervalMinutes: 0.4 } }).refresh, {
    ...DEFAULT_CONFIG.refresh,
    intervalMinutes: 1,
  })
  assert.deepEqual(normalizeConfig({ refresh: { intervalMinutes: 'soon' } }).refresh, DEFAULT_CONFIG.refresh)
})

test('normalizeConfig keeps the thresholds ordered, falling back to both defaults', () => {
  assert.deepEqual(normalizeConfig({ display: { thresholdWarnPercent: 70, thresholdCriticalPercent: 90 } }).display, {
    thresholdWarnPercent: 70,
    thresholdCriticalPercent: 90,
    progressBar: true,
  })
  assert.deepEqual(normalizeConfig({ display: { thresholdWarnPercent: 99, thresholdCriticalPercent: 50 } }).display, DEFAULT_CONFIG.display)
  assert.deepEqual(normalizeConfig({ display: { thresholdWarnPercent: 90, thresholdCriticalPercent: 90 } }).display, DEFAULT_CONFIG.display)
  assert.deepEqual(normalizeConfig({ display: { thresholdWarnPercent: 200, thresholdCriticalPercent: 300 } }).display, DEFAULT_CONFIG.display)
})

test('normalizeConfig treats a non-boolean progress bar flag as the default', () => {
  assert.equal(normalizeConfig({ display: { progressBar: false } }).display.progressBar, false)
  assert.equal(normalizeConfig({ display: { progressBar: 'yes' } }).display.progressBar, true)
})

test('normalizeConfig never throws, whatever the document contains', () => {
  const hostile = {
    models: [{ provider: { toString: () => 'p' }, model: 'm', sourceId: [], mode: {} }],
    sources: { a: { apiKeyRef: 42, baseUrl: {} } },
    refresh: { intervalMinutes: Number.NaN, turnEndDelayMs: Number.POSITIVE_INFINITY },
    display: { thresholdWarnPercent: Number.NEGATIVE_INFINITY, progressBar: null },
  }

  const config = normalizeConfig(hostile)

  assert.deepEqual(config, {
    models: [],
    order: [],
    providers: {},
    sources: {},
    refresh: DEFAULT_CONFIG.refresh,
    display: DEFAULT_CONFIG.display,
  })
})
