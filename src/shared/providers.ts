import { suggestSourceId, type UsageStateConfig } from './config.ts'
import type { SourceCatalog } from './display.ts'
import type { UsageMode } from './types.ts'

/**
 * Provider-level resolution: which account (data source) and which reading mode
 * a DSH provider maps to.
 *
 * The readings this plugin shows are **account-level** — every model behind one
 * provider shares the same balance or quota — so the configuration unit is the
 * provider, not the model. Configuration stores only deviations: an absent entry
 * means "figure it out", which is what makes the plugin work with zero setup for
 * a provider whose key DSH already has.
 */

export type ProviderResolutionReason =
  /** Explicitly configured. */
  | 'configured'
  /** Nothing configured; the suggestion was used. */
  | 'auto'
  /** The user hid this provider. */
  | 'hidden'
  /** The provider has no data source the plugin knows. */
  | 'unknown-source'
  /** The data source cannot serve the requested mode. */
  | 'unsupported'
  /** A self-hosted source needs an endpoint before anything can be read. */
  | 'needs-endpoint'

export interface ProviderResolution {
  provider: string
  /** Data source to read, or null when there is nothing to show. */
  sourceId: string | null
  /** Mode to read it in, or null when there is nothing to show. */
  mode: UsageMode | null
  reason: ProviderResolutionReason
  baseUrl?: string
  apiKeyRef?: string
  /** Snapshot key the browser looks up; present only when sourceId and mode are set. */
  key?: string
}

export interface ResolveProviderInput {
  provider: string
  config: UsageStateConfig
  catalog: SourceCatalog
  /** Endpoint declared by the DSH provider profile; used only to suggest a source. */
  endpointHint?: string
}

function withTarget(resolution: ProviderResolution): ProviderResolution {
  if (resolution.sourceId === null || resolution.mode === null) return resolution
  return { ...resolution, key: `${resolution.sourceId}:${resolution.mode}` }
}

/**
 * Resolve one provider. `auto` picks the source the provider id (or its endpoint)
 * suggests and that source's primary mode, so a provider DSH already has a key
 * for starts working without touching the settings page.
 */
export function resolveProvider(input: ResolveProviderInput): ProviderResolution {
  const entry = input.config.providers[input.provider]
  const baseUrl = entry?.baseUrl
  const base: Pick<ProviderResolution, 'provider' | 'baseUrl' | 'apiKeyRef'> = {
    provider: input.provider,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(entry?.apiKeyRef === undefined ? {} : { apiKeyRef: entry.apiKeyRef }),
  }

  if (entry?.mode === 'hidden') {
    return { ...base, sourceId: null, mode: null, reason: 'hidden' }
  }

  const sourceId = entry?.sourceId ?? suggestSourceId(input.provider, input.endpointHint) ?? null
  if (sourceId === null) {
    return { ...base, sourceId: null, mode: null, reason: 'unknown-source' }
  }

  const source = input.catalog.find(candidate => candidate.id === sourceId)
  if (source === undefined) {
    return { ...base, sourceId, mode: null, reason: 'unknown-source' }
  }

  if (entry?.mode === 'api' || entry?.mode === 'coding-plan') {
    if (!source.modes.includes(entry.mode)) {
      return { ...base, sourceId, mode: null, reason: 'unsupported' }
    }
    return withTarget({ ...base, sourceId, mode: entry.mode, reason: 'configured' })
  }

  // Auto: the source's primary mode (DeepSeek and Kimi lead with `api`, z.ai has
  // only `coding-plan`). A self-hosted source cannot be read before it has an endpoint.
  if (source.requiresBaseUrl && baseUrl === undefined) {
    return { ...base, sourceId, mode: null, reason: 'needs-endpoint' }
  }
  const mode = source.modes[0]
  if (mode === undefined) {
    return { ...base, sourceId, mode: null, reason: 'unsupported' }
  }
  return withTarget({ ...base, sourceId, mode, reason: 'auto' })
}

/**
 * Display order: the configured order first, then any provider the caller knows
 * about that the order does not mention yet (so a newly configured provider never
 * disappears from the page).
 */
export function orderProviders(providers: readonly string[], config: UsageStateConfig): string[] {
  const ordered = config.order.filter(provider => providers.includes(provider))
  const missing = providers.filter(provider => !ordered.includes(provider))
  return [...ordered, ...missing]
}
