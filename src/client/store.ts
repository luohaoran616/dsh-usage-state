import type { SourceCatalog } from '../shared/display.ts'
import type { CredentialDescription, CredentialReport, RemoteResult, UsageStateView } from '../shared/rpc.ts'
import type { UsageSnapshot } from '../shared/types.ts'

/** Everything the browser half renders from. */
export interface UsageStateClientState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  catalog: SourceCatalog
  snapshots: Record<string, UsageSnapshot>
  credentials: Record<string, CredentialDescription>
  checkedAt: number | undefined
  /** Why the last reading refresh failed, if it did. */
  error: string | undefined
  /** Why the last credential status lookup failed, if it did. */
  credentialsError: string | undefined
}

export interface UsageStateClientDeps {
  getState(force: boolean): Promise<RemoteResult<UsageStateView>>
  describeCredentials(): Promise<RemoteResult<CredentialReport>>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The browser's mirror of the host's readings.
 *
 * Two rules keep the status line honest: a failed refresh never clears what is
 * already displayed (it only records why), and concurrent callers share one
 * in-flight call so a component re-render cannot multiply RPC traffic.
 */
export class UsageStateClientStore {
  private readonly deps: UsageStateClientDeps
  private readonly listeners = new Set<() => void>()
  private state: UsageStateClientState = {
    status: 'idle',
    catalog: [],
    snapshots: {},
    credentials: {},
    checkedAt: undefined,
    error: undefined,
    credentialsError: undefined,
  }

  private inflight: Promise<void> | undefined

  constructor(deps: UsageStateClientDeps) {
    this.deps = deps
  }

  getSnapshot(): UsageStateClientState {
    return this.state
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private publish(patch: Partial<UsageStateClientState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of [...this.listeners]) listener()
  }

  refresh(force = false): Promise<void> {
    if (this.inflight !== undefined) return this.inflight

    this.publish({ status: 'loading' })
    const run = (async () => {
      try {
        const result = await this.deps.getState(force)
        if (!result.ok) {
          this.publish({ status: 'error', error: result.error.message })
          return
        }
        this.publish({
          status: 'ready',
          catalog: result.value.sources,
          snapshots: result.value.snapshots,
          checkedAt: result.value.checkedAt,
          error: undefined,
        })
      } catch (error) {
        this.publish({ status: 'error', error: messageOf(error) })
      }
    })().finally(() => {
      this.inflight = undefined
    })

    this.inflight = run
    return run
  }

  async refreshCredentials(): Promise<void> {
    try {
      const result = await this.deps.describeCredentials()
      if (!result.ok) {
        this.publish({ credentialsError: result.error.message })
        return
      }
      this.publish({ credentials: result.value.credentials, credentialsError: undefined })
    } catch (error) {
      this.publish({ credentialsError: messageOf(error) })
    }
  }
}
