import type { SnapshotError, UsageReading, UsageSnapshot } from '../shared/types.ts'
import type { UsageSource } from './sources/types.ts'
import { SourceError } from './sources/types.ts'
import type { UsageTarget } from './targets.ts'

/** Injectable time source: keeps the scheduler testable without real timers. */
export interface RefreshClock {
  now(): number
  /** Run `fn` once after `ms`; returns a cancel function. */
  after(ms: number, fn: () => void): () => void
  /** Run `fn` every `ms`; returns a cancel function. */
  every(ms: number, fn: () => void): () => void
}

export interface RefreshPolicy {
  intervalMinutes: number
  turnEndDelayMs: number
  minIntervalSeconds: number
}

export interface ResolvedTargetCredential {
  apiKey: string
  ref: string
  origin: string
  /** Endpoint override from settings (regional mirrors, self-hosted gateways). */
  baseUrl?: string
}

export interface UsageStateStoreDeps {
  clock: RefreshClock
  /** Read live from settings on every use, so config edits apply without a restart. */
  policy(): RefreshPolicy
  /** The current set of readings to keep fresh, in display order. */
  targets(): UsageTarget[]
  findSource(id: string): UsageSource | undefined
  credentials: {
    resolve(target: UsageTarget): Promise<ResolvedTargetCredential | undefined>
  }
  /** Perform the HTTP request and parse the payload. */
  read(target: UsageTarget, credentials: ResolvedTargetCredential, source: UsageSource): Promise<UsageReading>
}

function toSnapshotError(error: unknown): SnapshotError {
  if (error instanceof SourceError) {
    return error.message === '' ? { kind: error.kind } : { kind: error.kind, detail: error.message }
  }
  if (error instanceof Error) {
    return error.message === '' ? { kind: 'unknown' } : { kind: 'unknown', detail: error.message }
  }
  return { kind: 'unknown' }
}

/**
 * Holds the last known reading of every configured source and decides when to
 * refresh it.
 *
 * The rules that matter for a plugin polling somebody else's billing endpoint:
 * a reading that succeeded is reused until the minimum interval has passed; a
 * failed attempt is never throttled (a retry may follow immediately); concurrent
 * callers share one in-flight request; and a failure never replaces a good
 * reading — it only marks it stale, so the status line can never show invented
 * numbers.
 */
export class UsageStateStore {
  // Note: plain field assignment rather than a constructor parameter property —
  // tests run through Node's strip-only TypeScript support, which rejects those.
  private readonly deps: UsageStateStoreDeps
  private readonly readings = new Map<string, UsageSnapshot>()
  private readonly succeededAt = new Map<string, number>()
  private readonly inflight = new Map<string, Promise<UsageSnapshot>>()
  private turnEndCancel: (() => void) | undefined
  private idleCancel: (() => void) | undefined

  constructor(deps: UsageStateStoreDeps) {
    this.deps = deps
  }

  /** Everything known so far, keyed by target key. */
  snapshots(): Record<string, UsageSnapshot> {
    const result: Record<string, UsageSnapshot> = {}
    for (const [key, snapshot] of this.readings) result[key] = snapshot
    return result
  }

  snapshot(key: string): UsageSnapshot | undefined {
    return this.readings.get(key)
  }

  /** Refresh every configured target; failures are captured, never thrown. */
  async refreshAll(): Promise<void> {
    await Promise.all(this.deps.targets().map(target => this.refresh(target.key)))
  }

  /**
   * Refresh one target. Returns the cached snapshot when the minimum interval has
   * not elapsed yet, unless `force` is set.
   */
  async refresh(key: string, options: { force?: boolean } = {}): Promise<UsageSnapshot> {
    const target = this.deps.targets().find(candidate => candidate.key === key)
    if (target === undefined) {
      return this.fail(
        { key, sourceId: key.split(':')[0] ?? '', mode: 'api' },
        { kind: 'config', detail: `unknown target ${key}` },
        this.readings.get(key),
      )
    }

    const cached = this.readings.get(key)
    const lastSuccess = this.succeededAt.get(key)
    if (
      options.force !== true &&
      cached !== undefined &&
      cached.error === undefined &&
      lastSuccess !== undefined &&
      this.deps.clock.now() - lastSuccess < this.deps.policy().minIntervalSeconds * 1000
    ) {
      return cached
    }

    const running = this.inflight.get(key)
    if (running !== undefined) return running

    const promise = this.run(target).finally(() => {
      this.inflight.delete(key)
    })
    this.inflight.set(key, promise)
    return promise
  }

  private async run(target: UsageTarget): Promise<UsageSnapshot> {
    const previous = this.readings.get(target.key)
    const source = this.deps.findSource(target.sourceId)
    if (source === undefined) {
      return this.fail(target, { kind: 'config', detail: `unknown source ${target.sourceId}` }, previous)
    }

    let credential: ResolvedTargetCredential | undefined
    try {
      credential = await this.deps.credentials.resolve(target)
    } catch (error) {
      return this.fail(target, toSnapshotError(error), previous)
    }
    if (credential === undefined) {
      return this.fail(target, { kind: 'config', detail: 'no credential configured' }, previous)
    }

    try {
      const reading = await this.deps.read(target, credential, source)
      const fetchedAt = this.deps.clock.now()
      const snapshot: UsageSnapshot = {
        sourceId: target.sourceId,
        mode: target.mode,
        balances: reading.balances,
        windows: reading.windows,
        fetchedAt,
      }
      this.readings.set(target.key, snapshot)
      this.succeededAt.set(target.key, fetchedAt)
      return snapshot
    } catch (error) {
      return this.fail(target, toSnapshotError(error), previous)
    }
  }

  private fail(target: UsageTarget, error: SnapshotError, previous: UsageSnapshot | undefined): UsageSnapshot {
    const snapshot: UsageSnapshot =
      previous === undefined
        ? {
            sourceId: target.sourceId,
            mode: target.mode,
            balances: [],
            windows: [],
            fetchedAt: this.deps.clock.now(),
            error,
          }
        : { ...previous, stale: true, error }
    this.readings.set(target.key, snapshot)
    return snapshot
  }

  /**
   * A turn just finished: refresh shortly, so the provider has time to settle the
   * request we just paid for. Repeated calls within the window collapse into one.
   */
  onTurnEnd(): void {
    if (this.turnEndCancel !== undefined) return
    const cancel = this.deps.clock.after(this.deps.policy().turnEndDelayMs, () => {
      this.turnEndCancel = undefined
      void this.refreshAll()
    })
    this.turnEndCancel = cancel
  }

  /** Start the idle fallback timer; returns a stop function. */
  start(): () => void {
    if (this.idleCancel === undefined) {
      const intervalMs = this.deps.policy().intervalMinutes * 60_000
      this.idleCancel = this.deps.clock.every(intervalMs, () => {
        void this.refreshAll()
      })
    }
    return () => this.stop()
  }

  stop(): void {
    this.turnEndCancel?.()
    this.turnEndCancel = undefined
    this.idleCancel?.()
    this.idleCancel = undefined
  }
}
