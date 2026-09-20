import type { SourceCatalog } from './display.ts'
import type { UsageSnapshot } from './types.ts'

/**
 * Types that cross the plugin's own RPC boundary.
 *
 * They live in `shared` rather than next to the host implementation so the
 * browser half can import them **type-only** without pulling host runtime code
 * into the client bundle.
 */

/** One credential candidate's status — never its value. */
export interface CredentialCandidate {
  ref: string
  configured: boolean
  source?: string
  /** False when an inherited environment variable shadows the stored value. */
  writable?: boolean
}

export interface CredentialDescription {
  candidates: CredentialCandidate[]
  configured: boolean
  ref?: string
  source?: string
  /** Whether the resolved ref could be written from the settings page. */
  writable?: boolean
}

export interface UsageStateView {
  sources: SourceCatalog
  snapshots: Record<string, UsageSnapshot>
  checkedAt: number
}

export interface CredentialReport {
  credentials: Record<string, CredentialDescription>
}

/** The result envelope every RPC call resolves to: failures are returned, not thrown. */
export type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
