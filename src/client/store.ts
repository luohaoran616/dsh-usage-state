import type { ModelCatalogLike } from './context.ts'
import type { CatalogModelRow, ProviderRegistry } from './model-rows.ts'
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
  /** Models DSH knows about, flattened for the settings page. */
  models: CatalogModelRow[]
  /**
   * Which providers DSH currently has. `undefined` while the catalog has not loaded
   * (or when the host does not report one): the settings page then treats the
   * registry as unknown and keeps every stored entry visible.
   */
  modelRegistry: ProviderRegistry | undefined
  /** Why the last reading refresh failed, if it did. */
  error: string | undefined
  /** Why the last credential status lookup failed, if it did. */
  credentialsError: string | undefined
  /** Why the last model-catalog lookup failed, if it did. */
  modelsError: string | undefined
}

export interface UsageStateClientDeps {
  getState(force: boolean): Promise<RemoteResult<UsageStateView>>
  describeCredentials(): Promise<RemoteResult<CredentialReport>>
  modelCatalog?(): Promise<RemoteResult<ModelCatalogLike>>
}

/** Flatten the DSH model catalog into the rows the settings page lists. */
export function flattenCatalog(catalog: ModelCatalogLike | undefined): CatalogModelRow[] {
  if (catalog === undefined) return []
  const rows: CatalogModelRow[] = []
  for (const group of catalog.groups) {
    for (const model of group.models) {
      rows.push({ provider: group.id, providerName: group.name, model: model.id, name: model.name })
    }
  }
  return rows
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The registry view of a catalog result, or `undefined` when it does not carry one
 * (a host older than `routableProviders`). Unknown is not the same as empty: the
 * settings page keeps stored entries visible while the registry is unknown, so a
 * failed or unavailable catalog can never hide configuration that needs clearing.
 */
export function registryOf(catalog: ModelCatalogLike | undefined): ProviderRegistry | undefined {
  if (catalog?.routableProviders === undefined) return undefined
  return {
    routable: [...catalog.routableProviders],
    failed: (catalog.failures ?? []).map(failure => failure.id),
  }
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
    models: [],
    modelRegistry: undefined,
    error: undefined,
    credentialsError: undefined,
    modelsError: undefined,
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

  /** Load the model catalog once per settings-page visit. */
  async refreshModels(): Promise<void> {
    if (this.deps.modelCatalog === undefined) return
    try {
      const result = await this.deps.modelCatalog()
      if (!result.ok) {
        // The registry is unknown again, not stale: a list we could not read must
        // not be used to conclude that a provider is gone.
        this.publish({ modelsError: result.error.message, modelRegistry: undefined })
        return
      }
      this.publish({
        models: flattenCatalog(result.value),
        modelRegistry: registryOf(result.value),
        modelsError: undefined,
      })
    } catch (error) {
      this.publish({ modelsError: messageOf(error), modelRegistry: undefined })
    }
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
