import type { QuotaWindow, UsageMode, UsageReading } from '../../shared/types.ts'
import { clampPercent, normalizeBaseUrl, normalizeResetAt, toFiniteNumber } from './normalize.ts'
import { SourceError, type RequestInput, type UsageRequest, type UsageSource } from './types.ts'

const MOONSHOT_BASE_URL = 'https://api.moonshot.cn'
const KIMI_CODE_BASE_URL = 'https://api.kimi.com'
/** The Kimi Code quota endpoint rejects requests without the CLI user agent. */
const KIMI_CLI_USER_AGENT = 'KimiCLI/1.6'

const WINDOW_RANK: Record<string, number> = { '5h': 0, '1d': 1, '7d': 2 }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function firstFinite(candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    const parsed = toFiniteNumber(candidate)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

/**
 * Moonshot's balance is documented in cents by some sources and in yuan by others,
 * and there is no field that disambiguates the two. This mirrors the heuristic used
 * by the plugin this project replaces: amounts of 100 or more are read as cents.
 * Verified against a real key before trusting the absolute value.
 */
function moonshotBalanceToYuan(value: number): number {
  const yuan = value >= 100 ? value / 100 : value
  return Math.round(yuan * 100) / 100
}

/** Used percentage from an explicit used/limit pair, or by inverting remaining. */
function percentFrom(record: Record<string, unknown>): number | null {
  const limit = toFiniteNumber(record.limit)
  if (limit === undefined || limit <= 0) return null

  const used = toFiniteNumber(record.used)
  if (used !== undefined) return clampPercent((used / limit) * 100)

  const remaining = toFiniteNumber(record.remaining)
  if (remaining !== undefined) return clampPercent(((limit - remaining) / limit) * 100)
  return null
}

/** `{ duration: 5, timeUnit: 'hour' }` -> `5h`, and weekly variants -> `7d`. */
function windowIdFrom(window: Record<string, unknown> | undefined): string | undefined {
  if (window === undefined) return undefined
  const unit = typeof window.timeUnit === 'string' ? window.timeUnit.trim().toLowerCase() : ''
  const duration = toFiniteNumber(window.duration)
  if (unit === '' || duration === undefined || duration <= 0) return undefined

  if (unit.startsWith('hour')) return `${duration}h`
  if (unit.startsWith('day')) return duration === 7 ? '7d' : `${duration}d`
  if (unit.startsWith('week')) return duration === 1 ? '7d' : `${duration * 7}d`
  if (unit.startsWith('minute')) return `${duration}m`
  if (unit.startsWith('month')) return '30d'
  return `${duration}${unit.slice(0, 4)}`
}

function sortWindows(windows: Iterable<QuotaWindow>): QuotaWindow[] {
  return [...windows].sort((a, b) => (WINDOW_RANK[a.id] ?? 99) - (WINDOW_RANK[b.id] ?? 99))
}

/** `GET /v1/users/me/balance` — pay-as-you-go wallet, CNY. */
function parseMoonshotBalance(payload: unknown): UsageReading {
  const root = asRecord(payload)
  const nested = root === undefined ? undefined : asRecord(root.data)
  const value = firstFinite([
    root?.available_balance,
    root?.balance,
    root?.cash_balance,
    nested?.available_balance,
    nested?.balance,
  ])
  if (value === undefined || value < 0) {
    throw new SourceError('parse', 'Moonshot balance response contains no usable balance field')
  }
  return { balances: [{ amount: moonshotBalanceToYuan(value), currency: 'CNY' }], windows: [] }
}

/**
 * `GET /coding/v1/usages` — Kimi Code subscription. The top-level `usage` is the
 * weekly quota; `limits[]` carries the rolling windows (5h among them). Neither is
 * officially documented, so every field is optional here.
 */
function parseKimiCodeUsage(payload: unknown): UsageReading {
  const root = asRecord(payload)
  if (root === undefined) throw new SourceError('parse', 'Kimi Code usage response is not a JSON object')

  const found = new Map<string, QuotaWindow>()

  const usage = asRecord(root.usage)
  if (usage !== undefined) {
    const usedPercent = percentFrom(usage)
    if (usedPercent !== null) {
      const resetsAt = normalizeResetAt(usage.resetTime ?? usage.reset_at ?? usage.resetsAt)
      found.set('7d', resetsAt === undefined ? { id: '7d', usedPercent } : { id: '7d', usedPercent, resetsAt })
    }
  }

  const limits = Array.isArray(root.limits) ? root.limits : []
  for (const raw of limits) {
    const row = asRecord(raw)
    const detail = row === undefined ? undefined : asRecord(row.detail)
    if (detail === undefined) continue

    const usedPercent = percentFrom(detail)
    if (usedPercent === null) continue

    const id = windowIdFrom(asRecord(row?.window))
    if (id === undefined || found.has(id)) continue
    const resetsAt = normalizeResetAt(detail.resetTime ?? detail.reset_at ?? detail.resetsAt)
    found.set(id, resetsAt === undefined ? { id, usedPercent } : { id, usedPercent, resetsAt })
  }

  if (found.size === 0) {
    throw new SourceError('parse', 'Kimi Code usage response contains no usable quota window')
  }
  return { balances: [], windows: sortWindows(found.values()) }
}

/**
 * Kimi / Moonshot. One vendor, two very different readings: the pay-as-you-go
 * wallet in API mode (`api.moonshot.cn`) and the Kimi Code subscription windows in
 * coding-plan mode (`api.kimi.com`).
 */
export const kimi: UsageSource = {
  id: 'kimi',
  displayName: 'Kimi / Moonshot',
  modes: ['api', 'coding-plan'],

  credentialRefs(mode: UsageMode): readonly string[] {
    return mode === 'coding-plan'
      ? ['KIMI_CODING_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY']
      : ['MOONSHOT_API_KEY', 'KIMI_API_KEY']
  },

  defaultBaseUrl(mode: UsageMode): string {
    return mode === 'coding-plan' ? KIMI_CODE_BASE_URL : MOONSHOT_BASE_URL
  },

  request(input: RequestInput): UsageRequest {
    const codingPlan = input.mode === 'coding-plan'
    const base = normalizeBaseUrl(input.baseUrl) ?? (codingPlan ? KIMI_CODE_BASE_URL : MOONSHOT_BASE_URL)
    return {
      url: codingPlan ? `${base}/coding/v1/usages` : `${base}/v1/users/me/balance`,
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        accept: 'application/json',
        ...(codingPlan ? { 'user-agent': KIMI_CLI_USER_AGENT } : {}),
      },
    }
  },

  parse(payload: unknown, mode: UsageMode): UsageReading {
    return mode === 'coding-plan' ? parseKimiCodeUsage(payload) : parseMoonshotBalance(payload)
  },
}
