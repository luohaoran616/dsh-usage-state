import type { UsageMode } from './types.ts'

/** Per-model mode. `hidden` keeps the model out of every status line. */
export type ModelMode = UsageMode | 'hidden'

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
  /** Display order is the array order (the settings page reorders it). */
  models: ModelConfigEntry[]
  sources: Record<string, SourceConfig>
  refresh: RefreshConfig
  display: DisplayConfig
}

export const DEFAULT_CONFIG: UsageStateConfig = {
  models: [],
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

const PROVIDER_HINTS: ReadonlyArray<{ sourceId: string; pattern: RegExp }> = [
  { sourceId: 'deepseek', pattern: /deepseek/ },
  { sourceId: 'zai', pattern: /(zai|zhipu|bigmodel|glm)/ },
  { sourceId: 'kimi', pattern: /(kimi|moonshot)/ },
  { sourceId: 'sub2api', pattern: /sub-?2-?api/ },
]

const HOST_HINTS: ReadonlyArray<{ sourceId: string; pattern: RegExp }> = [
  { sourceId: 'deepseek', pattern: /(^|\.)api\.deepseek\.com$/ },
  { sourceId: 'zai', pattern: /(^|\.)(api\.z\.ai|open\.bigmodel\.cn|bigmodel\.cn)$/ },
  { sourceId: 'kimi', pattern: /(^|\.)(api\.kimi\.com|api\.moonshot\.cn|moonshot\.cn)$/ },
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
