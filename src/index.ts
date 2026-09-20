import { DEFAULT_CONFIG, type UsageStateConfig } from './shared/config.ts'
import { toSourceCatalog } from './host/catalog.ts'
import { describeCredentials, resolveApiKey, type CredentialLookup } from './host/credentials.ts'
import { providerCredentialRefs } from './host/provider-refs.ts'
import { createTargetReader, type FetchLike } from './host/read.ts'
import { UsageStateStore } from './host/refresh.ts'
import { UsageStateService, USAGE_STATE_RPC_NAMESPACE, USAGE_STATE_SERVICE } from './host/service.ts'
import { installUsageStateSettings, type SettingsServiceLike } from './host/settings.ts'
import { ALL_SOURCES, findSource } from './host/sources/index.ts'
import { resolveTargets, type UsageTarget } from './host/targets.ts'

/**
 * The cordis members this plugin touches, typed structurally. The host half must
 * not import platform packages: a plugin mounted with `link:` resolves modules
 * from its own directory, where `@deepseek-ai/*` does not exist.
 */
export interface PluginContextLike {
  inject(names: readonly string[], callback: (ctx: { settings: SettingsServiceLike }) => void): void
  get(name: string): unknown
  on(event: string, handler: (...args: unknown[]) => void): () => void
  effect(callback: () => (() => void) | void, label?: string): void
  provide(name: string, value: unknown): void
  /** From the cordis timer plugin (see `inject` below). */
  timeout(callback: () => void, delay: number): () => void
  interval(callback: () => void, delay: number): () => void
}

export interface UsageStateDeps {
  /** Overridden in tests; production uses the global fetch. */
  fetch?: FetchLike
  now?: () => number
}

export const name = 'usage-state'
/** `timer` is what provides `ctx.timeout` / `ctx.interval`. */
export const inject = ['timer']

interface CredentialsProviderLike {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>
}

function readNamespace(ctx: PluginContextLike, namespace: string): unknown {
  const settings = ctx.get('settings') as { get?(ns: string): unknown } | undefined
  if (settings?.get === undefined) return undefined
  try {
    return settings.get(namespace)
  } catch {
    return undefined
  }
}

/**
 * Credential access through the host's credential provider. A provider that is
 * absent or throws must degrade to "not configured" — never to a crash inside a
 * refresh loop.
 */
export function createCredentialLookup(ctx: PluginContextLike): CredentialLookup {
  const provider = ctx.get('credentials') as CredentialsProviderLike | undefined

  return {
    resolve: async ref => {
      if (provider === undefined) return undefined
      try {
        return await provider.resolve(ref)
      } catch {
        return undefined
      }
    },
    describe: async ref => {
      if (provider === undefined) return { configured: false, writable: false }
      try {
        return await provider.describe(ref)
      } catch {
        return { configured: false, writable: false }
      }
    },
  }
}

/**
 * Publish the service under the name the RPC gateway resolves.
 *
 * The binding shape is exact and unforgiving (`dsh-api-gateway`'s `readBinding`):
 *   - `service` must be the service OBJECT itself, not its name;
 *   - `serviceKey` must be the registered name;
 *   - `namespace` must equal the RPC namespace.
 * A mismatch fails every dispatch with `gateway/binding-invalid` — which looks
 * like "the plugin silently returns nothing" from the browser. Non-enumerable so
 * it stays out of any serialization of the service.
 */
export function provideUsageState(
  ctx: Pick<PluginContextLike, 'provide'>,
  service: UsageStateService,
): UsageStateService {
  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: {
      service,
      serviceKey: USAGE_STATE_SERVICE,
      namespace: USAGE_STATE_RPC_NAMESPACE,
    },
  })
  ctx.provide(USAGE_STATE_SERVICE, service)
  return service
}

function isTurnEnd(event: unknown): boolean {
  return event !== null && typeof event === 'object' && (event as { type?: unknown }).type === 'turn/end'
}

/** Wire the whole host half; exported so tests can drive it with a fake context. */
export function createUsageState(ctx: PluginContextLike, deps: UsageStateDeps = {}): UsageStateService {
  const now = deps.now ?? ((): number => Date.now())
  const fetchImpl = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const catalog = toSourceCatalog(ALL_SOURCES)
  const lookup = createCredentialLookup(ctx)

  let config: UsageStateConfig = DEFAULT_CONFIG
  installUsageStateSettings(ctx, next => {
    config = next
  })

  const targets = (): UsageTarget[] => resolveTargets(config, ALL_SOURCES)
  const optionsFor = (target: UsageTarget) => {
    const overrideRef = config.sources[target.sourceId]?.apiKeyRef
    return {
      ...(overrideRef === undefined ? {} : { overrideRef }),
      preferredRefs: providerCredentialRefs({
        sourceId: target.sourceId,
        deepseekSettings: readNamespace(ctx, 'llm-deepseek'),
        piAiSettings: readNamespace(ctx, 'llm-pi-ai'),
      }),
    }
  }

  const store = new UsageStateStore({
    clock: {
      now,
      after: (ms, fn) => ctx.timeout(fn, ms),
      every: (ms, fn) => ctx.interval(fn, ms),
    },
    policy: () => config.refresh,
    targets,
    findSource,
    credentials: {
      resolve: async target => {
        const source = findSource(target.sourceId)
        if (source === undefined) return undefined
        const resolved = await resolveApiKey(source, target.mode, optionsFor(target), lookup)
        if (resolved === undefined) return undefined
        const baseUrl = config.sources[target.sourceId]?.baseUrl
        return baseUrl === undefined ? resolved : { ...resolved, baseUrl }
      },
    },
    read: createTargetReader({ fetch: fetchImpl }),
  })

  const service = new UsageStateService({
    store,
    targets,
    catalog: () => catalog,
    describe: async target => {
      const source = findSource(target.sourceId)
      if (source === undefined) return { candidates: [], configured: false }
      return describeCredentials(source, target.mode, optionsFor(target), lookup)
    },
    now,
  })

  // A finished turn is when provider-side settlement has just happened, so this
  // is the most accurate moment to re-read; the store delays and coalesces.
  ctx.on('session/event', (...args) => {
    if (isTurnEnd(args[1])) store.onTurnEnd()
  })
  store.start()

  return provideUsageState(ctx, service)
}

export function apply(ctx: PluginContextLike): void {
  createUsageState(ctx)
}
