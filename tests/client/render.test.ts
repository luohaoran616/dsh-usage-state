import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SettingsSection } from '../../src/client/SettingsSection.tsx'
import { StatusLine } from '../../src/client/StatusLine.tsx'
import { en } from '../../src/client/locales.ts'
import { normalizeConfig, type ProviderConfigEntry, type UsageStateConfig } from '../../src/shared/config.ts'
import type { SourceCatalog } from '../../src/shared/display.ts'
import type { UsageSnapshot } from '../../src/shared/types.ts'
import type { CredentialsRemoteLike } from '../../src/client/context.ts'
import type { CredentialDescription } from '../../src/shared/rpc.ts'

/**
 * Server-side renders of the real components. Effects (polling, settings
 * subscriptions) do not run here — the markup reflects the initial snapshot,
 * which is exactly the code path that has to be right on first paint.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` is replaced by a stub through
 * `tests/support/client-render-hook.mjs` (see `npm test`).
 */

const t = (key: string, params?: Record<string, unknown>): string => {
  let text = (en as Record<string, string>)[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

const CATALOG: SourceCatalog = [
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    modes: ['api'],
    requiresBaseUrl: false,
    defaultBaseUrl: { api: 'https://api.deepseek.com' },
    credentialRefs: { api: ['DEEPSEEK_API_KEY'] },
  },
  {
    id: 'zai',
    displayName: 'z.ai / GLM',
    modes: ['coding-plan'],
    requiresBaseUrl: false,
    defaultBaseUrl: { 'coding-plan': 'https://api.z.ai' },
    credentialRefs: { 'coding-plan': ['ZAI_API_KEY'] },
  },
  {
    id: 'sub2api',
    displayName: 'Sub2API',
    modes: ['api', 'coding-plan'],
    requiresBaseUrl: true,
    defaultBaseUrl: {},
    credentialRefs: { api: ['SUB2API_API_KEY'], 'coding-plan': ['SUB2API_API_KEY'] },
  },
]

function configWith(providers: Record<string, ProviderConfigEntry> = {}): UsageStateConfig {
  return normalizeConfig({ providers })
}

function storeWith(input: {
  catalog?: SourceCatalog
  snapshots?: Record<string, UsageSnapshot>
  credentials?: Record<string, CredentialDescription>
  models?: Array<{ provider: string; providerName: string; model: string; name: string }>
}) {
  const state = {
    status: 'ready' as const,
    catalog: input.catalog ?? [],
    snapshots: input.snapshots ?? {},
    credentials: input.credentials ?? {},
    checkedAt: 1_000,
    models: input.models ?? [],
    error: undefined,
    credentialsError: undefined,
    modelsError: undefined,
  }
  const source = {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    refresh: async () => undefined,
    refreshCredentials: async () => undefined,
    refreshModels: async () => undefined,
  }
  return source
}

/** The status line only needs the projection; the platform types it as a generic hook. */
const projectionOf = (selection: { provider: string; model: string } | undefined) =>
  ((_key: string) => (selection === undefined ? undefined : { next: selection, lastUsed: null })) as <T>(
    key: string,
  ) => T | undefined

function settingsWith(config: UsageStateConfig) {
  const snapshot = { status: 'ready' as const, value: config, revision: 1, writable: true, mode: 'host' as const }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    set: async () => undefined,
    unset: async () => undefined,
    mutate: async () => undefined,
  }
}

const CREDENTIALS: CredentialsRemoteLike = {
  describe: async () => ({ ok: true, value: {} }),
  set: async () => ({ ok: true, value: undefined }),
  unset: async () => ({ ok: true, value: undefined }),
}

test('the status line renders a balance for the session model', () => {
  const config = configWith({ 'deepseek-official': { mode: 'api' } })
  const store = storeWith({
    catalog: CATALOG,
    snapshots: {
      'deepseek:api': {
        sourceId: 'deepseek',
        mode: 'api',
        balances: [{ amount: 66.28, currency: 'CNY' }],
        windows: [],
        fetchedAt: 1_000,
      },
    },
  })

  const html = renderToStaticMarkup(
    h(StatusLine, {
      t,
      variant: 'dock',
      usageState: store,
      settings: settingsWith(config),
      useProjection: projectionOf({ provider: 'deepseek-official', model: 'deepseek-flash' }),
    }),
  )

  assert.match(html, /data-usage-state="dock"/)
  assert.match(html, /DeepSeek/)
  assert.match(html, /¥66\.28/)
  assert.match(html, /max-width:var\(--dsh-chat-content-width\)/)
  // Hovering the line explains where the number comes from.
  assert.match(html, /data-tooltip="Source DeepSeek · Mode API balance"/)
})

test('the turn-tail variant renders quota windows with severity, countdown and bar', () => {
  const config = configWith({ zai: { mode: 'coding-plan' } })
  const catalog: SourceCatalog = [...CATALOG]
  const store = storeWith({
    catalog,
    snapshots: {
      'zai:coding-plan': {
        sourceId: 'zai',
        mode: 'coding-plan',
        balances: [],
        windows: [
          { id: '5h', usedPercent: 42, resetsAt: Date.now() + 4 * 3600_000 + 60_000 },
          { id: '7d', usedPercent: 96 },
        ],
        fetchedAt: 1_000,
      },
    },
  })

  const html = renderToStaticMarkup(
    h(StatusLine, {
      t,
      variant: 'turnTail',
      usageState: store,
      settings: settingsWith(config),
      useProjection: projectionOf({ provider: 'zai', model: 'glm-4.6' }),
    }),
  )

  assert.match(html, /data-usage-state="turnTail"/)
  assert.match(html, /z\.ai \/ GLM/)
  assert.match(html, /5h 42%/)
  assert.match(html, /\(4h\d+m\)/)
  assert.match(html, /7d 96%/)
  assert.match(html, /data-tooltip="[^"]*Resets at [^"]*Source z\.ai \/ GLM · Mode Coding plan"/)
  // 96% crosses the critical threshold, so it must use the error colour.
  assert.match(html, /--dsw-alias-state-error-primary/)
  assert.match(html, /--dsw-alias-state-warn-primary|--dsw-alias-label-secondary/)
})

test('a hidden or unselected model renders nothing at all', () => {
  const hidden = settingsWith(configWith({ p: { mode: 'hidden' } }))
  const props = {
    t,
    variant: 'dock' as const,
    usageState: storeWith({ catalog: CATALOG }),
    settings: hidden,
    useProjection: projectionOf({ provider: 'p', model: 'm' }),
  }
  assert.equal(renderToStaticMarkup(h(StatusLine, props)), '')

  const noSelection = renderToStaticMarkup(h(StatusLine, { ...props, useProjection: projectionOf(undefined) }))
  assert.equal(noSelection, '')
})

test('a provider nobody can map says so instead of showing a number', () => {
  const html = renderToStaticMarkup(
    h(StatusLine, {
      t,
      variant: 'dock',
      usageState: storeWith({ catalog: CATALOG }),
      settings: settingsWith(configWith()),
      useProjection: projectionOf({ provider: 'mystery', model: 'unconfigured' }),
    }),
  )

  assert.match(html, /Not configured/)
})

test('a self-hosted provider without an endpoint asks for one', () => {
  const html = renderToStaticMarkup(
    h(StatusLine, {
      t,
      variant: 'dock',
      usageState: storeWith({ catalog: CATALOG }),
      settings: settingsWith(configWith()),
      useProjection: projectionOf({ provider: 'sub2api', model: 'gpt-5' }),
    }),
  )

  assert.match(html, /Needs an endpoint first/)
})

test('a stale reading stays visible and is marked', () => {
  const config = configWith({ 'deepseek-official': { mode: 'api' } })
  const html = renderToStaticMarkup(
    h(StatusLine, {
      t,
      variant: 'dock',
      usageState: storeWith({
        catalog: CATALOG,
        snapshots: {
          'deepseek:api': {
            sourceId: 'deepseek',
            mode: 'api',
            balances: [{ amount: 12.5, currency: 'USD' }],
            windows: [],
            fetchedAt: Date.now() - 12 * 60_000,
            stale: true,
            error: { kind: 'network', detail: 'offline' },
          },
        },
      }),
      settings: settingsWith(config),
      useProjection: projectionOf({ provider: 'deepseek-official', model: 'deepseek-flash' }),
    }),
  )

  assert.match(html, /⚠/)
  assert.match(html, /showing the last value that was fetched successfully/i)
  assert.match(html, /12m ago/)
  assert.match(html, /\$12\.50/)
})

test('the settings page shows one row per provider with its models and resolved account', () => {
  const store = storeWith({
    catalog: CATALOG,
    models: [
      { provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-flash', name: 'DeepSeek V4 Flash' },
      { provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { provider: 'zai', providerName: 'z.ai / GLM', model: 'glm-4.6', name: 'GLM-4.6' },
    ],
    credentials: {
      'deepseek:api': {
        candidates: [{ ref: 'DEEPSEEK_API_KEY', configured: true, source: 'env', writable: true }],
        configured: true,
        ref: 'DEEPSEEK_API_KEY',
        source: 'env',
        writable: true,
      },
    },
  })

  const html = renderToStaticMarkup(
    h(SettingsSection, {
      close: () => undefined,
      t,
      usageState: store,
      settings: settingsWith(configWith()),
      credentials: CREDENTIALS,
    }),
  )

  assert.match(html, /Usage state/)
  assert.match(html, /DeepSeek/)
  // Models are listed once per provider, not once per row of controls.
  assert.match(html, /Models: DeepSeek V4 Flash · DeepSeek V4 Pro/)
  assert.match(html, /Detected DeepSeek · API balance/)
  assert.match(html, /z\.ai \/ GLM/)
  assert.match(html, /Detected z\.ai \/ GLM · Coding plan/)
  // Auto is offered everywhere; only the source's own modes otherwise.
  assert.match(html, /Auto/)
  assert.match(html, /API balance/)
  assert.match(html, /Coding plan/)
  assert.match(html, /Hidden/)
  assert.match(html, /DEEPSEEK_API_KEY/)
  assert.match(html, /Configured \(env\)/)
  assert.match(html, /Advanced/)
})

test('the settings page shows why a reading failed, not just that it did', () => {
  const html = renderToStaticMarkup(
    h(SettingsSection, {
      close: () => undefined,
      t,
      usageState: storeWith({
        catalog: CATALOG,
        models: [{ provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-flash', name: 'DeepSeek V4 Flash' }],
        snapshots: {
          'deepseek:api': {
            sourceId: 'deepseek',
            mode: 'api',
            balances: [],
            windows: [],
            fetchedAt: 1_000,
            error: { kind: 'config', detail: 'no credential configured' },
          },
        },
      }),
      settings: settingsWith(configWith()),
      credentials: CREDENTIALS,
    }),
  )

  assert.match(html, /Missing key or endpoint/)
  assert.match(html, /no credential configured/)
})

test('the settings page demands an endpoint for a self-hosted provider', () => {
  const html = renderToStaticMarkup(
    h(SettingsSection, {
      close: () => undefined,
      t,
      usageState: storeWith({
        catalog: CATALOG,
        models: [{ provider: 'sub2api', providerName: 'Sub2API', model: 'gpt-5', name: 'gpt-5' }],
      }),
      settings: settingsWith(configWith()),
      credentials: CREDENTIALS,
    }),
  )

  assert.match(html, /Sub2API/)
  assert.match(html, /Needs an endpoint first/)
  assert.match(html, /This data source needs the endpoint of your own instance/)
  assert.match(html, /SUB2API_API_KEY/)
})

test('a hidden provider is marked as such instead of showing a target', () => {
  const html = renderToStaticMarkup(
    h(SettingsSection, {
      close: () => undefined,
      t,
      usageState: storeWith({
        catalog: CATALOG,
        models: [{ provider: 'zai', providerName: 'z.ai / GLM', model: 'glm-4.6', name: 'GLM-4.6' }],
      }),
      settings: settingsWith(configWith({ zai: { mode: 'hidden' } })),
      credentials: CREDENTIALS,
    }),
  )

  assert.match(html, /Hidden/)
  assert.doesNotMatch(html, /Detected/)
})

test('the empty hint only shows when there is nothing to list at all', () => {
  const withProviders = renderToStaticMarkup(
    h(SettingsSection, {
      close: () => undefined,
      t,
      usageState: storeWith({
        catalog: CATALOG,
        models: [{ provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-flash', name: 'DeepSeek V4 Flash' }],
      }),
      settings: settingsWith(configWith()),
      credentials: CREDENTIALS,
    }),
  )
  assert.doesNotMatch(withProviders, /No providers found yet/)

  const withoutProviders = renderToStaticMarkup(
    h(SettingsSection, {
      close: () => undefined,
      t,
      usageState: storeWith({ catalog: CATALOG }),
      settings: settingsWith(configWith()),
      credentials: CREDENTIALS,
    }),
  )
  assert.match(withoutProviders, /No providers found yet/)
})

test('the settings page reports an unavailable settings transport instead of rendering controls', () => {
  const unavailable = {
    getSnapshot: () => ({ status: 'unavailable' as const, value: undefined, revision: undefined, writable: false, mode: 'memory' as const }),
    subscribe: () => () => undefined,
    set: async () => undefined,
    unset: async () => undefined,
    mutate: async () => undefined,
  }

  const html = renderToStaticMarkup(
    h(SettingsSection, {
      close: () => undefined,
      t,
      usageState: storeWith({}),
      settings: unavailable,
      credentials: CREDENTIALS,
    }),
  )

  assert.match(html, /does not serve settings/)
  assert.doesNotMatch(html, /API balance/)
})
