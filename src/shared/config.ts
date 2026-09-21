import type { UsageMode } from './types.ts'

/** Per-model mode. `hidden` keeps the model out of every status line. */
export type ModelMode = UsageMode | 'hidden'

/**
 * Per-provider mode. `auto` (the default) means "use the source this provider
 * suggests, in that source's primary mode" — which is what lets a provider whose
 * key DSH already holds work without any configuration at all.
 */
export type ProviderMode = UsageMode | 'hidden' | 'auto'

/** Configuration for one DSH provider; only deviations from `auto` are stored. */
export interface ProviderConfigEntry {
  mode: ProviderMode
  /** Override the suggested data source. */
  sourceId?: string
  /** Endpoint override for this provider (mirrors, self-hosted instances). */
  baseUrl?: string
  /** Credential ref override for this provider. */
  apiKeyRef?: string
}

/**
 * One configured model. The data source is chosen explicitly because DSH provider
 * ids are user-defined (`llm-pi-ai.providers` keys are free-form), so the plugin
 * only *suggests* a source and the user confirms it.
 */
export interface ModelConfigEntry {
  provider: string
  model: string
  /** Chosen data source id, or null while the user has not configured this model. */
  sourceId: string | null
  mode: ModelMode
}

/** Per-source overrides: another credential ref, or a different endpoint. */
export interface SourceConfig {
  /** DSH credential ref to use instead of the source's built-in probe order. */
  apiKeyRef?: string
  /** Endpoint override (regional mirrors, self-hosted gateways). */
  baseUrl?: string
}

export interface RefreshConfig {
  /** Idle refresh cadence. */
  intervalMinutes: number
  /** Delay after a turn ends before refreshing, to let the provider settle. */
  turnEndDelayMs: number
  /** Hard floor between two real HTTP calls for the same source. */
  minIntervalSeconds: number
}

export interface DisplayConfig {
  /** Used percentage at which the reading turns amber. */
  thresholdWarnPercent: number
  /** Used percentage at which the reading turns red. */
  thresholdCriticalPercent: number
  progressBar: boolean
}

/** The plugin's whole configuration, persisted in the DSH settings namespace. */
export interface UsageStateConfig {
  /**
   * Legacy per-model entries. Superseded by {@link providers} (readings are
   * account-level, so models are not the right unit) and kept only so an older
   * document keeps working; `normalizeConfig` migrates their choices.
   */
  models: ModelConfigEntry[]
  /** Display order of providers; providers missing here follow in catalog order. */
  order: string[]
  /** Per-provider overrides, keyed by DSH provider id. */
  providers: Record<string, ProviderConfigEntry>
  /** Legacy per-source overrides; superseded by {@link ProviderConfigEntry.baseUrl}. */
  sources: Record<string, SourceConfig>
  refresh: RefreshConfig
  display: DisplayConfig
}

export const DEFAULT_CONFIG: UsageStateConfig = {
  models: [],
  order: [],
  providers: {},
  sources: {},
  refresh: {
    intervalMinutes: 5,
    turnEndDelayMs: 2000,
    minIntervalSeconds: 60,
  },
  display: {
    thresholdWarnPercent: 80,
    thresholdCriticalPercent: 95,
    progressBar: true,
  },
}

const MODES: readonly ModelMode[] = ['api', 'coding-plan', 'hidden']
const PROVIDER_MODES: readonly ProviderMode[] = ['api', 'coding-plan', 'hidden', 'auto']

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampInt(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

function normalizeModels(value: unknown): ModelConfigEntry[] {
  if (!Array.isArray(value)) return []

  const models: ModelConfigEntry[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    const entry = asRecord(raw)
    if (entry === undefined) continue

    const provider = cleanString(entry.provider)
    const model = cleanString(entry.model)
    if (provider === '' || model === '') continue

    const identity = `${provider}\u0000${model}`
    if (seen.has(identity)) continue
    seen.add(identity)

    const rawMode = cleanString(entry.mode)
    const mode: ModelMode = MODES.includes(rawMode as ModelMode) ? (rawMode as ModelMode) : 'hidden'
    const sourceId = cleanString(entry.sourceId)

    models.push({ provider, model, sourceId: sourceId === '' ? null : sourceId, mode })
  }
  return models
}

function normalizeSources(value: unknown): Record<string, SourceConfig> {
  const root = asRecord(value)
  if (root === undefined) return {}

  const sources: Record<string, SourceConfig> = {}
  for (const [id, raw] of Object.entries(root)) {
    const entry = asRecord(raw)
    if (entry === undefined) continue

    const config: SourceConfig = {}
    const apiKeyRef = cleanString(entry.apiKeyRef)
    if (apiKeyRef !== '') config.apiKeyRef = apiKeyRef
    const baseUrl = cleanString(entry.baseUrl)
    if (baseUrl !== '') config.baseUrl = baseUrl

    if (config.apiKeyRef !== undefined || config.baseUrl !== undefined) sources[id] = config
  }
  return sources
}

function normalizeRefresh(value: unknown): RefreshConfig {
  const root = asRecord(value) ?? {}
  const defaults = DEFAULT_CONFIG.refresh
  return {
    intervalMinutes: clampInt(root.intervalMinutes, 1, 1440, defaults.intervalMinutes),
    turnEndDelayMs: clampInt(root.turnEndDelayMs, 0, 60_000, defaults.turnEndDelayMs),
    minIntervalSeconds: clampInt(root.minIntervalSeconds, 0, 3600, defaults.minIntervalSeconds),
  }
}

function normalizeDisplay(value: unknown): DisplayConfig {
  const root = asRecord(value) ?? {}
  const defaults = DEFAULT_CONFIG.display

  const progressBar = typeof root.progressBar === 'boolean' ? root.progressBar : defaults.progressBar
  const thresholdWarnPercent = clampInt(root.thresholdWarnPercent, 1, 100, defaults.thresholdWarnPercent)
  const thresholdCriticalPercent = clampInt(root.thresholdCriticalPercent, 1, 100, defaults.thresholdCriticalPercent)

  // An unordered pair of thresholds cannot color anything sensibly, so fall back
  // to both defaults rather than silently reinterpreting what the user meant.
  if (thresholdWarnPercent >= thresholdCriticalPercent) return { ...defaults, progressBar }

  return { thresholdWarnPercent, thresholdCriticalPercent, progressBar }
}

function normalizeProviders(value: unknown): Record<string, ProviderConfigEntry> {
  const root = asRecord(value)
  if (root === undefined) return {}

  const providers: Record<string, ProviderConfigEntry> = {}
  for (const [id, raw] of Object.entries(root)) {
    const entry = asRecord(raw)
    if (entry === undefined) continue

    const rawMode = cleanString(entry.mode)
    const mode: ProviderMode = PROVIDER_MODES.includes(rawMode as ProviderMode)
      ? (rawMode as ProviderMode)
      : 'auto'

    const normalized: ProviderConfigEntry = { mode }
    const sourceId = cleanString(entry.sourceId)
    if (sourceId !== '') normalized.sourceId = sourceId
    const baseUrl = cleanString(entry.baseUrl)
    if (baseUrl !== '') normalized.baseUrl = baseUrl
    const apiKeyRef = cleanString(entry.apiKeyRef)
    if (apiKeyRef !== '') normalized.apiKeyRef = apiKeyRef

    providers[id] = normalized
  }
  return providers
}

/** Keep the stored order sane and append providers it does not mention. */
function normalizeOrder(value: unknown, providers: Record<string, ProviderConfigEntry>): string[] {
  const order: string[] = []
  if (Array.isArray(value)) {
    for (const raw of value) {
      const id = cleanString(raw)
      if (id === '' || order.includes(id)) continue
      order.push(id)
    }
  }
  for (const id of Object.keys(providers)) {
    if (!order.includes(id)) order.push(id)
  }
  return order
}

/**
 * Turn whatever the hand-editable settings document contains into a usable
 * config. Deliberately never throws: the settings provider calls the schema
 * synchronously at registration time, and a dirty section must not block the
 * plugin from loading. Malformed pieces fall back to defaults instead.
 *
 * Legacy per-model entries are migrated into provider entries so an existing
 * document keeps the choices its owner already made.
 */
export function normalizeConfig(raw: unknown): UsageStateConfig {
  const root = asRecord(raw) ?? {}
  const models = normalizeModels(root.models)
  const providers = normalizeProviders(root.providers)

  for (const entry of models) {
    if (providers[entry.provider] !== undefined) continue
    providers[entry.provider] = {
      mode: entry.mode,
      ...(entry.sourceId === null ? {} : { sourceId: entry.sourceId }),
    }
  }

  return {
    models,
    order: normalizeOrder(root.order, providers),
    providers,
    sources: normalizeSources(root.sources),
    refresh: normalizeRefresh(root.refresh),
    display: normalizeDisplay(root.display),
  }
}

const PROVIDER_HINTS: ReadonlyArray<{ sourceId: string; pattern: RegExp }> = [
  // Gateways first: an id that names sub2api is a self-hosted relay whatever
  // models it happens to serve (`sub2api-opencode` is not an OpenCode account).
  { sourceId: 'sub2api', pattern: /sub-?2-?api/ },
  // Then OpenCode, and before deepseek: the Zen Go route that serves a DeepSeek
  // model is literally named `opencode-go-deepseek`, so a bare `/deepseek/` test
  // would otherwise claim it for the DeepSeek account.
  { sourceId: 'opencode', pattern: /opencode/ },
  { sourceId: 'deepseek', pattern: /deepseek/ },
  { sourceId: 'zai', pattern: /(zai|zhipu|bigmodel|glm)/ },
  { sourceId: 'kimi', pattern: /(kimi|moonshot)/ },
]

const HOST_HINTS: ReadonlyArray<{ sourceId: string; pattern: RegExp }> = [
  { sourceId: 'deepseek', pattern: /(^|\.)api\.deepseek\.com$/ },
  { sourceId: 'zai', pattern: /(^|\.)(api\.z\.ai|open\.bigmodel\.cn|bigmodel\.cn)$/ },
  { sourceId: 'kimi', pattern: /(^|\.)(api\.kimi\.com|api\.moonshot\.cn|moonshot\.cn)$/ },
  { sourceId: 'opencode', pattern: /(^|\.)opencode\.ai$/ },
]

/**
 * Best guess at which data source backs a DSH provider. Provider id first (cheap
 * and usually right), then the endpoint host. Because any unrecognised endpoint is
 * most likely a self-hosted gateway, that is the last resort rather than `undefined`.
 */
export function suggestSourceId(providerId: string, baseUrl?: string): string | undefined {
  const normalized = providerId.trim().toLowerCase()
  for (const hint of PROVIDER_HINTS) {
    if (hint.pattern.test(normalized)) return hint.sourceId
  }

  if (baseUrl === undefined) return undefined
  let host: string
  try {
    host = new URL(baseUrl.trim()).host.toLowerCase()
  } catch {
    return undefined
  }
  for (const hint of HOST_HINTS) {
    if (hint.pattern.test(host)) return hint.sourceId
  }
  return 'sub2api'
}
