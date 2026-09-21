import type { UsageStateConfig } from '../shared/config.ts'
import { resolveProvider } from '../shared/providers.ts'
import type { UsageMode } from '../shared/types.ts'
import { toSourceCatalog } from './catalog.ts'
import { ALL_SOURCES, findSource } from './sources/index.ts'
import type { UsageSource } from './sources/types.ts'

/** One pollable reading: an account-level source used in one mode. */
export interface UsageTarget {
  /** Stable key, also used by the browser to look a snapshot up. */
  key: string
  sourceId: string
  mode: UsageMode
  /** Endpoint override: the plugin's own setting, else the provider's declared origin. */
  baseUrl?: string
  /** True when the endpoint is the user's explicit choice, so no mirror is tried. */
  baseUrlPinned?: boolean
}

export function targetKey(sourceId: string, mode: UsageMode): string {
  return `${sourceId}:${mode}`
}

export interface TargetOptions {
  sources?: readonly UsageSource[]
  /**
   * DSH provider ids. Supplying them is what makes zero configuration work: a
   * provider nobody has configured still resolves to its suggested source, so its
   * account is read and can be shown as soon as a session uses a model behind it.
   */
  providers?: readonly string[]
  /** Endpoint per provider, used only to sharpen the source suggestion. */
  endpointHints?: Readonly<Record<string, string>>
}

/**
 * The set of readings the plugin should keep fresh, in display order.
 *
 * Balance and quota are account-level, so several providers (or legacy per-model
 * entries) sharing one source and mode collapse into a single target — the status
 * line never shows the same account twice. Providers that are hidden, map to no
 * known source, or ask for a mode the source cannot serve are skipped silently.
 */
export function resolveTargets(
  config: UsageStateConfig,
  options: TargetOptions = {},
): UsageTarget[] {
  const sources = options.sources ?? ALL_SOURCES
  const catalog = toSourceCatalog(sources)
  const targets: UsageTarget[] = []
  const seen = new Set<string>()

  const push = (sourceId: string, mode: UsageMode, endpoint?: { baseUrl?: string; pinned?: boolean }): void => {
    const source = sources.find(candidate => candidate.id === sourceId)
    if (source === undefined || !source.modes.includes(mode)) return
    const key = targetKey(sourceId, mode)
    // Account-level: the first provider that maps here owns the reading, so a
    // second provider of the same source cannot silently change the endpoint.
    if (seen.has(key)) return
    seen.add(key)
    targets.push({
      key,
      sourceId,
      mode,
      ...(endpoint?.baseUrl === undefined ? {} : { baseUrl: endpoint.baseUrl }),
      ...(endpoint?.pinned === true ? { baseUrlPinned: true } : {}),
    })
  }

  /**
   * The live runtime's provider ids, when we have them. An empty list means "could
   * not ask" (the `llm` service is missing on early ticks), not "nothing exists", so
   * it must not suppress the configured entries.
   */
  const live = options.providers !== undefined && options.providers.length > 0 ? new Set(options.providers) : undefined
  /**
   * Whether a stored entry may still produce requests. The entry itself is kept — a
   * provider that comes back keeps the mode the user chose for it — but a provider
   * DSH no longer has must not keep an account being polled behind an invisible row.
   */
  const pollable = (provider: string): boolean => live === undefined || live.has(provider)

  // Legacy per-model entries first: an older document's explicit choices still win.
  for (const entry of config.models) {
    if (entry.mode === 'hidden' || entry.sourceId === null) continue
    if (!pollable(entry.provider)) continue
    push(entry.sourceId, entry.mode)
  }

  const providers = new Set<string>()
  for (const provider of [...config.order, ...Object.keys(config.providers)]) {
    if (pollable(provider)) providers.add(provider)
  }
  for (const provider of options.providers ?? []) providers.add(provider)
  for (const provider of providers) {
    const resolution = resolveProvider({
      provider,
      config,
      catalog,
      ...(options.endpointHints?.[provider] === undefined ? {} : { endpointHint: options.endpointHints[provider] }),
    })
    if (resolution.sourceId !== null && resolution.mode !== null) {
      push(resolution.sourceId, resolution.mode, {
        ...(resolution.baseUrl === undefined ? {} : { baseUrl: resolution.baseUrl }),
        ...(resolution.baseUrlPinned === true ? { pinned: true } : {}),
      })
    }
  }

  return targets
}

export { findSource }
