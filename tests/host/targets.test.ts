import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_CONFIG, normalizeConfig, suggestSourceId } from '../../src/shared/config.ts'
import { ALL_SOURCES, findSource } from '../../src/host/sources/index.ts'
import { resolveTargets, targetKey } from '../../src/host/targets.ts'
import type { UsageStateConfig } from '../../src/shared/config.ts'

function configWith(models: UsageStateConfig['models']): UsageStateConfig {
  return { ...DEFAULT_CONFIG, models }
}

test('the source registry exposes every v1 source by id', () => {
  assert.deepEqual(
    ALL_SOURCES.map(source => source.id).sort(),
    ['deepseek', 'kimi', 'opencode', 'sub2api', 'zai'],
  )
  assert.equal(findSource('zai')?.displayName, 'z.ai / GLM')
  assert.equal(findSource('opencode')?.displayName, 'OpenCode Zen Go')
  assert.equal(findSource('nope'), undefined)
})

test('default config keeps every model unconfigured and hidden until the user chooses', () => {
  assert.deepEqual(DEFAULT_CONFIG.models, [])
  assert.equal(DEFAULT_CONFIG.refresh.intervalMinutes, 5)
  assert.equal(DEFAULT_CONFIG.refresh.turnEndDelayMs, 2000)
  assert.equal(DEFAULT_CONFIG.refresh.minIntervalSeconds, 60)
  assert.equal(DEFAULT_CONFIG.display.thresholdWarnPercent, 80)
  assert.equal(DEFAULT_CONFIG.display.thresholdCriticalPercent, 95)
  assert.equal(DEFAULT_CONFIG.display.progressBar, true)
})

test('suggestSourceId recognises the provider ids people actually configure', () => {
  assert.equal(suggestSourceId('deepseek-official'), 'deepseek')
  assert.equal(suggestSourceId('deepseek'), 'deepseek')
  assert.equal(suggestSourceId('zai'), 'zai')
  assert.equal(suggestSourceId('bigmodel'), 'zai')
  assert.equal(suggestSourceId('zhipu'), 'zai')
  assert.equal(suggestSourceId('glm-coding-plan'), 'zai')
  assert.equal(suggestSourceId('kimi'), 'kimi')
  assert.equal(suggestSourceId('moonshot'), 'kimi')
  assert.equal(suggestSourceId('kimi-code'), 'kimi')
  assert.equal(suggestSourceId('sub2api'), 'sub2api')
  assert.equal(suggestSourceId('opencode-go'), 'opencode')
  assert.equal(suggestSourceId('opencode-go-deepseek'), 'opencode')
  assert.equal(suggestSourceId('opencode'), 'opencode')
  // A self-hosted gateway that merely relays OpenCode models stays a gateway:
  // the sub2api hint is checked first on purpose.
  assert.equal(suggestSourceId('sub2api-opencode'), 'sub2api')
  assert.equal(suggestSourceId('my-relay'), undefined)
})

test('suggestSourceId falls back to the endpoint host when the provider id says nothing', () => {
  assert.equal(suggestSourceId('my-relay', 'https://api.deepseek.com/v1'), 'deepseek')
  assert.equal(suggestSourceId('my-relay', 'https://open.bigmodel.cn/api/paas/v4'), 'zai')
  assert.equal(suggestSourceId('my-relay', 'https://api.kimi.com/coding/v1'), 'kimi')
  assert.equal(suggestSourceId('my-relay', 'https://api.moonshot.cn/v1'), 'kimi')
  assert.equal(suggestSourceId('my-relay', 'https://opencode.ai/zen/go/v1'), 'opencode')
  assert.equal(suggestSourceId('my-relay', 'https://opencode.ai'), 'opencode')
  assert.equal(suggestSourceId('my-relay', 'https://gw.example.com'), 'sub2api')
  assert.equal(suggestSourceId('my-relay', 'not a url'), undefined)
})

test('both OpenCode Go routes collapse into one coding-plan target', () => {
  const config = normalizeConfig({
    providers: { 'opencode-go': {}, 'opencode-go-deepseek': {} },
  })
  const targets = resolveTargets(config, {
    providers: ['opencode-go', 'opencode-go-deepseek'],
    endpointHints: { 'opencode-go-deepseek': 'https://opencode.ai/zen/go/v1' },
  })

  // Account-level: the built-in route and the custom DeepSeek route are one account.
  assert.equal(targets.length, 1)
  assert.equal(targets[0]?.key, 'opencode:coding-plan')
  assert.equal(targets[0]?.sourceId, 'opencode')
  assert.equal(targets[0]?.mode, 'coding-plan')
  // Only the origin is kept, whatever the winning route declared.
  assert.ok(
    targets[0]?.baseUrl === undefined || targets[0]?.baseUrl === 'https://opencode.ai',
    `unexpected baseUrl ${targets[0]?.baseUrl}`,
  )
})

test('targetKey is stable and per source+mode', () => {
  assert.equal(targetKey('deepseek', 'api'), 'deepseek:api')
  assert.equal(targetKey('kimi', 'coding-plan'), 'kimi:coding-plan')
})

test('resolveTargets skips hidden models, unconfigured models and unsupported modes', () => {
  const targets = resolveTargets(
    configWith([
      { provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'api' },
      { provider: 'zai', model: 'glm-4.6', sourceId: 'zai', mode: 'hidden' },
      { provider: 'kimi', model: 'kimi-k2', sourceId: 'kimi', mode: 'coding-plan' },
      { provider: 'x', model: 'y', sourceId: null, mode: 'api' },
      { provider: 'ghost', model: 'z', sourceId: 'ghost-source', mode: 'api' },
    ]),
  )

  assert.deepEqual(targets, [
    { key: 'deepseek:api', sourceId: 'deepseek', mode: 'api' },
    { key: 'kimi:coding-plan', sourceId: 'kimi', mode: 'coding-plan' },
  ])
})

test('resolveTargets refuses a mode the source cannot serve', () => {
  // DeepSeek has no coding plan; asking for one must not create a pollable target.
  const targets = resolveTargets(
    configWith([{ provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'coding-plan' }]),
  )

  assert.deepEqual(targets, [])
})

test('resolveTargets carries the endpoint a provider declares', () => {
  // Provider-shaped config, so the declared endpoint has somewhere to land.
  const config = normalizeConfig({ providers: { 'zai-cn': { mode: 'coding-plan' } } })
  const targets = resolveTargets(config, {
    endpointHints: { 'zai-cn': 'https://api.z.ai/api/paas/v4' },
  })

  assert.deepEqual(targets, [
    { key: 'zai:coding-plan', sourceId: 'zai', mode: 'coding-plan', baseUrl: 'https://api.z.ai' },
  ])
})

test('resolveTargets deduplicates models that share one account-level reading', () => {
  const targets = resolveTargets(
    configWith([
      { provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'api' },
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', sourceId: 'deepseek', mode: 'api' },
      { provider: 'zai', model: 'glm-4.6', sourceId: 'zai', mode: 'coding-plan' },
      { provider: 'zai', model: 'glm-4.5-air', sourceId: 'zai', mode: 'coding-plan' },
    ]),
  )

  assert.deepEqual(targets.map(target => target.key), ['deepseek:api', 'zai:coding-plan'])
})
