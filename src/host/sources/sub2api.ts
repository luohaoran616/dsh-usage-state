import type { BalanceAmount, QuotaWindow, UsageMode, UsageReading } from '../../shared/types.ts'
import { clampPercent, normalizeBaseUrl, normalizeResetAt, toFiniteNumber } from './normalize.ts'
import { SourceError, type RequestInput, type UsageRequest, type UsageSource } from './types.ts'

const USAGE_PATH = '/v1/usage'
const DEFAULT_CURRENCY = 'USD'

const WINDOW_RANK: Record<string, number> = { '5h': 0, '1d': 1, '7d': 2, '30d': 3 }

/** Subscription window name -> our canonical id. */
const SUBSCRIPTION_WINDOWS: ReadonlyArray<{ prefix: string; id: string }> = [
  { prefix: 'daily', id: '1d' },
  { prefix: 'weekly', id: '7d' },
  { prefix: 'monthly', id: '30d' },
]

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function currencyOf(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CURRENCY
  const trimmed = value.trim().toUpperCase()
  return trimmed === '' ? DEFAULT_CURRENCY : trimmed
}

/** `window: "5h" | "1d" | "7d"` as sent by Sub2API; unknown names are kept as-is. */
function rateWindowId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const key = raw.trim().toLowerCase()
  if (key === '') return undefined
  if (key === '5h') return '5h'
  if (key === '1d' || key === '24h') return '1d'
  if (key === '7d' || key === '168h') return '7d'
  if (key === '30d' || key === '1mo') return '30d'
  return /^[a-z0-9.]+$/.test(key) ? key : undefined
}

function sortWindows(windows: Iterable<QuotaWindow>): QuotaWindow[] {
  return [...windows].sort((a, b) => (WINDOW_RANK[a.id] ?? 99) - (WINDOW_RANK[b.id] ?? 99))
}

function percentFromPair(used: unknown, limit: unknown): number | null {
  const cap = toFiniteNumber(limit)
  const spent = toFiniteNumber(used)
  if (cap === undefined || cap <= 0 || spent === undefined) return null
  return clampPercent((spent / cap) * 100)
}

/**
 * Sub2API is a self-hosted gateway that redistributes subscription quota as its own
 * `sk-` keys. `GET /v1/usage` is the only endpoint an API key can read, it is
 * undocumented and its field names have drifted between frontend and backend, so
 * every field here is optional and unknown shapes degrade instead of throwing.
 */
export const sub2api: UsageSource = {
  id: 'sub2api',
  displayName: 'Sub2API',
  modes: ['api', 'coding-plan'],
  requiresBaseUrl: true,
  credentialRefs: () => ['SUB2API_API_KEY'],
  /** Self-hosted: there is no sensible default endpoint. */
  defaultBaseUrl: () => undefined,

  request(input: RequestInput): UsageRequest {
    const base = normalizeBaseUrl(input.baseUrl)
    if (base === undefined) {
      throw new SourceError('config', 'Sub2API requires the base URL of your own instance')
    }
    return {
      url: `${base}${USAGE_PATH}`,
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        accept: 'application/json',
      },
    }
  },

  parse(payload: unknown, _mode: UsageMode): UsageReading {
    const root = asRecord(payload)
    if (root === undefined) throw new SourceError('parse', 'Sub2API usage response is not a JSON object')

    const balances: BalanceAmount[] = []
    const windows = new Map<string, QuotaWindow>()

    // Key quota first: a quota-limited key has no wallet balance, but its remaining
    // USD allowance is what the user wants to see. `remaining: -1` means unlimited.
    const quota = asRecord(root.quota)
    const quotaRemaining = quota === undefined ? undefined : toFiniteNumber(quota.remaining)
    const quotaLimit = quota === undefined ? undefined : toFiniteNumber(quota.limit)
    if (quotaRemaining !== undefined && quotaRemaining >= 0 && quotaLimit !== undefined && quotaLimit > 0) {
      balances.push({ amount: quotaRemaining, currency: currencyOf(quota?.unit ?? root.unit) })
    } else {
      const wallet = toFiniteNumber(root.balance)
      if (wallet !== undefined && wallet >= 0) {
        balances.push({ amount: wallet, currency: currencyOf(root.unit) })
      }
    }

    const rateLimits = Array.isArray(root.rate_limits) ? root.rate_limits : []
    for (const raw of rateLimits) {
      const entry = asRecord(raw)
      if (entry === undefined) continue

      const id = rateWindowId(entry.window)
      if (id === undefined || windows.has(id)) continue

      const usedPercent = percentFromPair(entry.used, entry.limit)
      if (usedPercent === null) continue

      const resetsAt = normalizeResetAt(entry.reset_at ?? entry.resetAt)
      windows.set(id, resetsAt === undefined ? { id, usedPercent } : { id, usedPercent, resetsAt })
    }

    // Subscription groups expose daily/weekly/monthly limits instead of rate_limits.
    const subscription = asRecord(root.subscription)
    if (subscription !== undefined) {
      for (const { prefix, id } of SUBSCRIPTION_WINDOWS) {
        if (windows.has(id)) continue
        const usedPercent = percentFromPair(subscription[`${prefix}_usage_usd`], subscription[`${prefix}_limit_usd`])
        if (usedPercent === null) continue
        windows.set(id, { id, usedPercent })
      }
    }

    const sorted = sortWindows(windows.values())
    if (balances.length === 0 && sorted.length === 0) {
      throw new SourceError('parse', 'Sub2API usage response carries neither balance nor quota window')
    }
    return { balances, windows: sorted }
  },
}
