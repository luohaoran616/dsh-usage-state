import { createElement } from 'react'

import { normalizeConfig, type UsageStateConfig } from '../shared/config.ts'
import type { CredentialReport, UsageStateView } from '../shared/rpc.ts'
import { SettingsSection } from './SettingsSection.tsx'
import { StatusLine } from './StatusLine.tsx'
import { en, LOCALE_NS, zh } from './locales.ts'
import { UsageStateClientStore } from './store.ts'
import type { ClientContextLike, ModelCatalogLike, SettingsScopeLike } from './context.ts'

// `remote.session` carries the model catalog and `remote.credentials` the key
// store; both are platform-provided service names that must be declared here or
// `ctx.remote.<ns>` is undefined at call time.
export const inject = ['slots', 'locale', 'settingsScope', 'remote', 'remote.session', 'remote.credentials']

const USAGE_STATE_NS = 'usage-state'
const POLL_INTERVAL_MS = 30_000

/** Hand-rolled codecs: the browser bundle must not carry zod. */
const booleanOrUndefined = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-usage-state#Force',
  schema: { parse: (value: unknown) => (value === undefined ? undefined : value === true) },
}

const srcJson = { mode: 'src-json' as const }

/** Must mirror `src/host/typert.ts`: the wire endpoint is `<namespace>/<method>`. */
const CONTRIBUTION = {
  package: 'dsh-usage-state',
  descriptors: [
    {
      id: 'dsh-usage-state#usageState/getState',
      service: 'usageState',
      namespace: 'usageState',
      method: 'getState',
      invocation: { kind: 'direct' as const },
      parameters: [{ name: 'force', wire: 'force', source: 'json' as const, acceptsUndefined: true, codec: booleanOrUndefined }],
      result: srcJson,
    },
    {
      id: 'dsh-usage-state#usageState/describeCredentials',
      service: 'usageState',
      namespace: 'usageState',
      method: 'describeCredentials',
      invocation: { kind: 'direct' as const },
      parameters: [],
      result: srcJson,
    },
  ],
}

export function apply(ctx: ClientContextLike): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-usage-state: dictionaries')
  const t = ctx.locale.bind(LOCALE_NS)

  const settings: SettingsScopeLike<UsageStateConfig> = ctx.settingsScope.bind<UsageStateConfig>({
    namespace: USAGE_STATE_NS,
    // The host already resolved this section; normalizing again keeps a
    // hand-edited document from reaching the components as a broken shape.
    decode: section => normalizeConfig(section),
  })

  const store = new UsageStateClientStore({
    getState: async force => {
      const service = ctx.remote.usageState
      if (service === undefined) return { ok: false, error: { message: 'remote not mounted' } }
      return service.getState(force)
    },
    describeCredentials: async () => {
      const service = ctx.remote.usageState
      if (service === undefined) return { ok: false, error: { message: 'remote not mounted' } }
      return service.describeCredentials()
    },
    modelCatalog: async () => {
      const session = ctx.remote.session
      if (session === undefined) return { ok: false, error: { message: 'model catalog unavailable' } }
      return session.modelCatalog()
    },
  })

  // Mounting is asynchronous; the store stays empty (and the line stays quiet)
  // until the contribution is live, then fills on the first refresh.
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false
    void ctx.remote.$mount(CONTRIBUTION).then(
      off => {
        if (cancelled) {
          off()
          return
        }
        dispose = off
        void store.refresh(false)
        // The settings page may have mounted before the contribution was live.
        void store.refreshModels()
        void store.refreshCredentials()
      },
      () => undefined,
    )
    return () => {
      cancelled = true
      dispose?.()
    }
  }, 'dsh-usage-state: remote contribution')

  ctx.effect(() => {
    const timer = setInterval(() => {
      void store.refresh(false)
      // A model catalog lookup can lose a race at boot; keep trying until it lands
      // instead of showing an empty settings page forever.
      if (store.getSnapshot().models.length === 0) void store.refreshModels()
    }, POLL_INTERVAL_MS)

    const disposers = [
      // A finished turn is the moment the host refreshes, so pick it up at once.
      ctx.on('api-session/status', (...args) => {
        if (args[1] === false) void store.refresh(false)
      }),
      ctx.on('connection/reset', () => {
        void store.refresh(true)
      }),
      settings.subscribe(() => {
        void store.refresh(false)
      }),
    ]

    return () => {
      clearInterval(timer)
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-usage-state: refresh loop')

  const seat = () => ({ usageState: store, settings })

  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      { name: 'conversation.composer.dock', id: 'usage-state', order: 1, locale: LOCALE_NS, inject: seat },
      (props: never) => createElement(StatusLine, { ...(props as object), variant: 'dock' } as never),
    ),
  )

  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.turnTail',
        // Lower priority is consulted first, so any plugin that already claims the
        // turn tail (produced files, and friends) still wins over this line.
        priority: 1,
        locale: LOCALE_NS,
        select: () => ({}),
        inject: seat,
      },
      (props: never) => createElement(StatusLine, { ...(props as object), variant: 'turnTail' } as never),
    ),
  )

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'usage-state',
        // After every official page (the platform's own sections use 15–100).
        order: 200,
        label: () => t('nav'),
        locale: LOCALE_NS,
        inject: () => ({ ...seat(), credentials: ctx.remote.credentials }),
      },
      SettingsSection as never,
    ),
  )
}

export type { ModelCatalogLike, UsageStateView, CredentialReport }
