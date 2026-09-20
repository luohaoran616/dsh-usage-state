/**
 * Types shared by the host and browser halves of the plugin.
 *
 * The host fetches raw provider payloads and normalizes them into these shapes;
 * the browser only renders them. All times are epoch milliseconds and all
 * percentages are "used" percentages in the range 0..100.
 */

/** How the usage of a model's account is read. */
export type UsageMode = 'api' | 'coding-plan'

/** A monetary balance, already scaled to the provider's major unit (yuan, dollars). */
export interface BalanceAmount {
  amount: number
  /** Currency code as reported by the provider, e.g. `CNY` / `USD`. */
  currency: string
  /** Provider-reported split, when the endpoint exposes one (DeepSeek does). */
  granted?: number
  toppedUp?: number
}

/** One rolling quota window (5h, 7d, ...) of a coding plan. */
export interface QuotaWindow {
  /** Stable window key: `5h`, `1d`, `7d`, or whatever the provider names it. */
  id: string
  /** Used percentage, 0..100, rounded to one decimal. */
  usedPercent: number
  /** Reset instant in epoch milliseconds; absent when the provider omits it. */
  resetsAt?: number
}

/** What a single successful read of one data source yields. */
export interface UsageReading {
  balances: BalanceAmount[]
  windows: QuotaWindow[]
}

/** Why a reading is unavailable. The browser turns this into localized copy. */
export interface SnapshotError {
  kind: 'config' | 'auth' | 'http' | 'network' | 'parse' | 'unknown'
  /** Raw provider/network detail, shown only as a tooltip — never as the main label. */
  detail?: string
}

/** A reading plus the bookkeeping the status line needs. */
export interface UsageSnapshot extends UsageReading {
  sourceId: string
  mode: UsageMode
  /** When the successful read behind this snapshot happened (epoch ms). */
  fetchedAt: number
  /** True when this is a previously fetched reading kept after a failed refresh. */
  stale?: boolean
  /** Why the last refresh attempt failed, if it did. */
  error?: SnapshotError
}
