import type { QuotaWindow, UsageMode, UsageReading } from '../../shared/types.ts'
import { clampPercent, normalizeBaseUrl, normalizePercent, normalizeResetAt, toFiniteNumber } from './normalize.ts'
import { SourceError, type RequestInput, type UsageRequest, type UsageSource } from './types.ts'

/**
 * GLM coding plans are regional and the key only works on its own region's host:
 * a China key answers `身份验证失败` on the global host and vice versa, with HTTP
 * 200 rather than a redirect. China is the primary because that is where the
 * coding plan is sold; the global host is the mirror.
 */
const CN_BASE_URL = 'https://open.bigmodel.cn'
const GLOBAL_BASE_URL = 'https://api.z.ai'
const QUOTA_PATH = '/api/monitor/usage/quota/limit'

/** Display order for the windows we know; anything else keeps its insertion order after these. */
const WINDOW_RANK: Record<string, number> = { '5h': 0, '1d': 1, '7d': 2 }

/** Provider window names -> our canonical ids. Unknown names are kept verbatim. */
function canonicalWindowId(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (/^(five_?hour|fivehour|rolling|5h)$/.test(key)) return '5h'
  if (/^(weekly|week|seven_?day|sevenday|7d)$/.test(key)) return '7d'
  if (/^(daily|day|1d)$/.test(key)) return '1d'
  if (/^month(ly)?$/.test(key)) return '30d'
  return key
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Percentage of one `limits[]` entry: explicit `percentage` first, else currentValue/usage. */
function percentOfLimit(limit: Record<string, unknown>): number | null {
  const explicit = toFiniteNumber(limit.percentage)
  if (explicit !== undefined) return clampPercent(explicit)

  const usage = toFiniteNumber(limit.usage)
  const current = toFiniteNumber(limit.currentValue)
  if (usage !== undefined && usage > 0 && current !== undefined) return clampPercent((current / usage) * 100)
  return null
}

/** The 2026-08 monitor endpoint: `data.limits[]`, mapped by unit (3 = hours, 6 = weeks). */
function parseLimits(data: Record<string, unknown>): QuotaWindow[] | undefined {
  const body = asRecord(data.data)
  const limits = body === undefined ? undefined : body.limits
  if (!Array.isArray(limits)) return undefined

  const found = new Map<string, QuotaWindow>()
  const unassigned: Array<{ usedPercent: number; resetsAt?: number; resetMs: number }> = []

  for (const raw of limits) {
    const limit = asRecord(raw)
    if (limit === undefined) continue
    // TOKENS_LIMIT (Pro/Max) and CREDIT_LIMIT (Lite) share semantics; TIME_LIMIT is a
    // monthly MCP budget in a different unit and must not be shown as a coding window.
    if (limit.type !== 'TOKENS_LIMIT' && limit.type !== 'CREDIT_LIMIT') continue

    const usedPercent = percentOfLimit(limit)
    if (usedPercent === null) continue
    const resetsAt = normalizeResetAt(limit.nextResetTime)
    const window: QuotaWindow = resetsAt === undefined ? { id: '', usedPercent } : { id: '', usedPercent, resetsAt }

    const unit = toFiniteNumber(limit.unit)
    if (unit === 3) {
      if (!found.has('5h')) found.set('5h', { ...window, id: '5h' })
    } else if (unit === 6) {
      if (!found.has('7d')) found.set('7d', { ...window, id: '7d' })
    } else if (unit === undefined) {
      unassigned.push({
        usedPercent,
        ...(resetsAt === undefined ? {} : { resetsAt }),
        resetMs: resetsAt ?? 0,
      })
    }
    // Finite but unknown units (daily credits and friends) are not coding windows.
  }

  // Limits without a unit are assigned by reset order: the window that resets first is
  // the 5h one. A 0%-used rolling window reports no reset time at all, so it sorts first.
  unassigned.sort((a, b) => a.resetMs - b.resetMs)
  for (const item of unassigned) {
    const id = found.has('5h') ? (found.has('7d') ? undefined : '7d') : '5h'
    if (id === undefined) break
    found.set(id, {
      id,
      usedPercent: item.usedPercent,
      ...(item.resetsAt === undefined ? {} : { resetsAt: item.resetsAt }),
    })
  }

  return found.size > 0 ? sortWindows(found.values()) : undefined
}

/** The legacy billing endpoint: `plans[]`, where the reset span decides 5h vs weekly. */
function parsePlans(data: Record<string, unknown>): QuotaWindow[] | undefined {
  if (!Array.isArray(data.plans)) return undefined

  const found = new Map<string, QuotaWindow>()
  for (const raw of data.plans) {
    const plan = asRecord(raw)
    if (plan === undefined) continue

    const total = toFiniteNumber(plan.total_units)
    const used = toFiniteNumber(plan.used_units)
    const usedPercent =
      total !== undefined && total > 0 && used !== undefined
        ? clampPercent((used / total) * 100)
        : normalizePercent(plan.utilization ?? plan.percent ?? plan.used_percentage)
    if (usedPercent === null) continue

    const resetsAt = normalizeResetAt(plan.period_end)
    // A 5h window always resets within a day; anything longer is the weekly window.
    const spanMs = resetsAt === undefined ? Number.NaN : resetsAt - Date.now()
    const id = Number.isFinite(spanMs) && spanMs > 24 * 3600_000 ? '7d' : '5h'
    found.set(id, resetsAt === undefined ? { id, usedPercent } : { id, usedPercent, resetsAt })
  }

  return found.size > 0 ? sortWindows(found.values()) : undefined
}

/** A flat `{ five_hour: { utilization, resets_at }, ... }` object (Anthropic-like). */
function parseFlatWindows(data: Record<string, unknown>): QuotaWindow[] | undefined {
  const found = new Map<string, QuotaWindow>()
  for (const [name, raw] of Object.entries(data)) {
    if (name === 'plans' || name === 'data') continue
    const entry = asRecord(raw)
    if (entry === undefined) continue

    const usedPercent = normalizePercent(entry.utilization ?? entry.percent ?? entry.used_percentage)
    if (usedPercent === null) continue

    const id = canonicalWindowId(name)
    if (found.has(id)) continue
    const resetsAt = normalizeResetAt(entry.resets_at ?? entry.reset_at ?? entry.resetsAt)
    found.set(id, resetsAt === undefined ? { id, usedPercent } : { id, usedPercent, resetsAt })
  }

  return found.size > 0 ? sortWindows(found.values()) : undefined
}

/** Recognise the error envelopes these endpoints return with HTTP 200. */
function errorEnvelope(root: Record<string, unknown>): { kind: 'auth' | 'http'; message: string } | undefined {
  const nested = asRecord(root.error)
  const rawCode = toFiniteNumber(root.code) ?? toFiniteNumber(nested?.code)
  const rawMessage =
    (typeof root.msg === 'string' && root.msg) ||
    (typeof root.message === 'string' && root.message) ||
    (typeof nested?.message === 'string' && nested.message) ||
    ''

  const failed = root.success === false || nested !== undefined
  if (!failed) return undefined

  const message = rawMessage.trim() === '' ? `error ${rawCode ?? 'unknown'}` : rawMessage.trim()
  // 1000 is the authentication failure code on both hosts.
  return { kind: rawCode === 1000 ? 'auth' : 'http', message }
}

function sortWindows(windows: Iterable<QuotaWindow>): QuotaWindow[] {
  return [...windows].sort((a, b) => (WINDOW_RANK[a.id] ?? 99) - (WINDOW_RANK[b.id] ?? 99))
}

/**
 * z.ai / Zhipu GLM coding plan. The monitor endpoint is the only documented-free
 * source of the rolling 5h and weekly windows; the legacy and flat shapes are kept
 * as fallbacks because the endpoint is community-reverse-engineered and has already
 * changed shape once.
 */
function quotaRequest(base: string, apiKey: string): UsageRequest {
  return {
    url: `${base}${QUOTA_PATH}`,
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
    },
  }
}

export const zai: UsageSource = {
  id: 'zai',
  displayName: 'z.ai / GLM',
  modes: ['coding-plan'],
  credentialRefs: () => ['ZAI_API_KEY', 'GLM_API_KEY', 'ZHIPU_API_KEY'],
  defaultBaseUrl: () => CN_BASE_URL,

  request(input: RequestInput): UsageRequest {
    return quotaRequest(normalizeBaseUrl(input.baseUrl) ?? CN_BASE_URL, input.apiKey)
  },

  /**
   * Try the other region unless the user pinned an endpoint themselves: a declared
   * host is a strong hint, but a wrong region guess is exactly what the mirror is
   * there to survive.
   */
  fallbackRequests(input: RequestInput): readonly UsageRequest[] {
    if (input.pinnedBaseUrl === true) return []
    const primary = normalizeBaseUrl(input.baseUrl) ?? CN_BASE_URL
    const mirror = primary === GLOBAL_BASE_URL ? CN_BASE_URL : GLOBAL_BASE_URL
    return [quotaRequest(mirror, input.apiKey)]
  },

  parse(payload: unknown, _mode: UsageMode): UsageReading {
    const root = asRecord(payload)
    if (root === undefined) throw new SourceError('parse', 'z.ai quota response is not a JSON object')

    // These endpoints report failures inside an HTTP 200 body:
    //   { code: 1000, msg: '身份验证失败。', success: false }
    //   { error: { code: '1000', message: 'Authentication Failed' } }
    // Reporting that as "could not be parsed" hides the actual problem.
    const failure = errorEnvelope(root)
    if (failure !== undefined) throw new SourceError(failure.kind, failure.message)

    const windows = parseLimits(root) ?? parsePlans(root) ?? parseFlatWindows(root)
    if (windows === undefined || windows.length === 0) {
      throw new SourceError('parse', 'z.ai quota response contains no usable 5h/7d window')
    }
    return { balances: [], windows }
  },
}
