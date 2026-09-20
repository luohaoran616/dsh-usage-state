import type { UsageMode, UsageReading } from '../../shared/types.ts'

/**
 * Why a source could not produce a reading. The UI maps these onto distinct
 * messages ("not configured" vs "key rejected" vs "temporarily unavailable").
 */
export type SourceFailureKind = 'config' | 'auth' | 'http' | 'network' | 'parse'

export class SourceError extends Error {
  readonly kind: SourceFailureKind

  constructor(kind: SourceFailureKind, message: string) {
    super(message)
    this.name = 'SourceError'
    this.kind = kind
  }
}

/** A fully resolved HTTP request; executed by the host's fetch layer. */
export interface UsageRequest {
  url: string
  headers: Record<string, string>
}

export interface RequestInput {
  mode: UsageMode
  apiKey: string
  /** Endpoint override: the plugin's own setting, or the provider's declared host. */
  baseUrl?: string
  /** True when the endpoint is the user's explicit choice, not a suggestion. */
  pinnedBaseUrl?: boolean
}

/**
 * A data source: how to ask for usage, and how to turn the answer into a reading.
 *
 * `request` and `parse` are deliberately separated: `parse` is pure so every
 * provider's payload handling is unit-testable without network access.
 */
export interface UsageSource {
  /** Stable id used in settings and snapshots, e.g. `deepseek`. */
  id: string
  /** Human-readable name shown in the settings page. */
  displayName: string
  /** Modes this source can serve; a mode absent here is not offered in settings. */
  modes: readonly UsageMode[]
  /**
   * Credential refs probed in order for a mode (see `credentialRef`), e.g.
   * `DEEPSEEK_API_KEY`. Mode-dependent because one vendor can need different keys
   * for its pay-as-you-go API and its coding plan.
   */
  credentialRefs(mode: UsageMode): readonly string[]
  /** Endpoint used for a mode when the user configures no override. */
  defaultBaseUrl(mode: UsageMode): string | undefined
  /** True when the endpoint must be supplied by the user (self-hosted services). */
  requiresBaseUrl?: boolean
  /** False for keyless sources; defaults to true. */
  requiresApiKey?: boolean
  request(input: RequestInput): UsageRequest
  /**
   * Mirror endpoints, tried in order when the primary one fails.
   *
   * Several of these providers are regional (z.ai global vs open.bigmodel.cn
   * China) and answer a wrong-region key with an authentication error rather than
   * a redirect, so a single hard-coded host is wrong for half the users. Adapters
   * that have mirrors declare them here and ignore `input.baseUrl` when the user
   * has explicitly chosen an endpoint.
   */
  fallbackRequests?(input: RequestInput): readonly UsageRequest[]
  /** Pure parser: raw JSON payload -> normalized reading. Throws `SourceError`. */
  parse(payload: unknown, mode: UsageMode): UsageReading
}
