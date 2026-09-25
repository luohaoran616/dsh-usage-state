import { createElement } from 'react'

import { normalizeConfig, type UsageStateConfig } from '../shared/config.ts'
import type { CredentialReport, RemoteResult, UsageStateView } from '../shared/rpc.ts'
import { SettingsSection } from './SettingsSection.tsx'
import { StatusLine } from './StatusLine.tsx'
import { en, LOCALE_NS, zh } from './locales.ts'
import { remoteService } from './remote.ts'
import { STATUS_LINE_SLOTS } from './slots.ts'
import { UsageStateClientStore } from './store.ts'
import type { ClientContextLike, CredentialsRemoteLike, ModelCatalogLike, RemoteServiceLike, SettingsScopeLike } from './context.ts'

// `remote.session` carries the model catalog; it is a platform-provided service
// name that must be declared here or `ctx.remote.<ns>` is undefined at call time.
// Fork note (dsh 0.1.7): `settingsScope` was removed upstream (settings moved to
// host-owned namespaces over `remote.settings`) and the host RPC now travels over
// webServer HTTP routes instead of Typert, so neither is injected here.
export const inject = ['slots', 'locale', 'remote', 'remote.session', 'remote.credentials']

const POLL_INTERVAL_MS = 30_000
const API_PREFIX = '/plugins/usage-state/api'

export function apply(ctx: ClientContextLike): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-usage-state: dictionaries')
  const t = ctx.locale.bind(LOCALE_NS)

  // Fork note (dsh 0.1.7): the platform client `settingsScope` service is gone.
  // This in-memory scope keeps every provider on its default (`自动`) resolution —
  // the mode this fork targets — while writes from the settings page stay live for
  // the session without persisting anywhere.
  const settings: SettingsScopeLike<UsageStateConfig> = (() => {
    let doc: Record<string, unknown> | undefined
    let snapshot = {
      status: 'ready' as const,
      value: normalizeConfig(doc),
      revision: 1,
      writable: true,
      mode: 'memory' as const,
    }
    const listeners = new Set<() => void>()
    const flush = () => {
      snapshot = { ...snapshot, value: normalizeConfig(doc) }
      for (const listener of listeners) listener()
    }
    return {
      getSnapshot: () => snapshot,
      subscribe: listener => (listeners.add(listener), () => listeners.delete(listener)),
      set: async (field, value) => {
        doc = { ...doc, [field]: value }
        flush()
      },
      unset: async field => {
        doc = { ...doc, [field]: undefined }
        flush()
      },
      mutate: async ops => {
        const next: Record<string, unknown> = { ...doc }
        for (const op of ops) {
          const key = String(op.path[op.path.length - 1] ?? '')
          if (op.op === 'set') next[key] = op.value
          else delete next[key]
        }
        doc = next
        flush()
      },
    }
  })()

  // Fork note (dsh 0.1.7): the host half serves the same payloads over webServer
  // HTTP routes (`src/host/http.ts`) instead of Typert RPC.
  const httpGet = async <T,>(path: string): Promise<RemoteResult<T>> => {
    try {
      const response = await fetch(`${API_PREFIX}${path}`, { headers: { accept: 'application/json' } })
      return (await response.json()) as RemoteResult<T>
    } catch (error) {
      return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
    }
  }

  const store = new UsageStateClientStore({
    getState: force => httpGet<UsageStateView>(`/state?force=${force ? 1 : 0}`),
    describeCredentials: () => httpGet<CredentialReport>('/credentials'),
    modelCatalog: async () => {
      const session = remoteService<{ modelCatalog(): Promise<RemoteResult<ModelCatalogLike>> }>(ctx, 'remote.session')
      if (session === undefined) return { ok: false, error: { message: 'model catalog unavailable' } }
      return session.modelCatalog()
    },
  })

  // Mounting is asynchronous; the store stays empty (and the line stays quiet)
  // until the contribution is live, then fills on the first refresh.
  // Fork note (dsh 0.1.7): the Typert `$mount` contribution is gone (HTTP instead);
  // this effect now only seeds the first refresh.
  ctx.effect(() => {
    void store.refresh(false)
    void store.refreshModels()
    void store.refreshCredentials()
  }, 'dsh-usage-state: initial refresh')

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

  // Mount points live as data (see slots.ts) so the choice stays testable: the
  // line has one home, the composer dock. Turn-scoped slots are deliberately not
  // used — a turn is the wrong axis for an account-level reading.
  for (const slot of STATUS_LINE_SLOTS) {
    ctx.slots.inject(slot.name, () =>
      ctx.slots.register(
        { name: slot.name, id: slot.id, order: slot.order, locale: slot.locale, inject: seat },
        (props: never) => createElement(StatusLine, props),
      ),
    )
  }

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'usage-state',
        // After every official page (the platform's own sections use 15–100).
        order: 200,
        label: () => t('nav'),
        locale: LOCALE_NS,
        inject: () => ({ ...seat(), credentials: remoteService<CredentialsRemoteLike>(ctx, 'remote.credentials') }),
      },
      SettingsSection as never,
    ),
  )
}

export type { ModelCatalogLike, UsageStateView, CredentialReport }
