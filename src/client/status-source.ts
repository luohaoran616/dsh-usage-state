import type { SourceCatalog } from '../shared/display.ts'
import type { CredentialDescription } from '../shared/rpc.ts'
import type { UsageSnapshot } from '../shared/types.ts'

/**
 * The slice of the client store the status line reads. Declared here so the
 * component does not depend on the store's full surface (and tests can pass a
 * literal).
 */
export interface UsageStateSnapshotSource {
  getSnapshot(): {
    catalog: SourceCatalog
    snapshots: Record<string, UsageSnapshot>
    credentials: Record<string, CredentialDescription>
  }
  subscribe(listener: () => void): () => void
}
