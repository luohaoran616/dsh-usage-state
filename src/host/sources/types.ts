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
  /** User-supplied endpoint override (self-hosted gateways). */
  baseUrl?: string
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
  /** Credential refs probed in order (see `credentialRef`), e.g. `DEEPSEEK_API_KEY`. */
  credentialRefs: readonly string[]
  /** Endpoint used when the user configures no override. */
  defaultBaseUrl?: string
  /** True when the endpoint must be supplied by the user (self-hosted services). */
  requiresBaseUrl?: boolean
  /** False for keyless sources; defaults to true. */
  requiresApiKey?: boolean
  request(input: RequestInput): UsageRequest
  /** Pure parser: raw JSON payload -> normalized reading. Throws `SourceError`. */
  parse(payload: unknown, mode: UsageMode): UsageReading
}
