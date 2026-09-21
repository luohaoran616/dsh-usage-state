import type { QuotaWindow, UsageMode, UsageReading } from '../../shared/types.ts'
import { clampPercent, normalizeBaseUrl, normalizeResetAt, toFiniteNumber } from './normalize.ts'
import { SourceError, type RequestInput, type UsageRequest, type UsageSource } from './types.ts'

const DEFAULT_BASE_URL = 'https://opencode.ai'
const QUOTA_PATH = '/zen/go/v1/usage'

/**
 * Cloudflare fronts opencode.ai and answers a non-browser agent with error 1010
 * (a flat 403), so the quota request has to present a real Chrome user agent.
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * The quota endpoint lives under `/zen/go/v1`. A provider profile declares its
 * `baseURL` as the *API* base (`https://opencode.ai/zen/go/v1`), the settings page can
 * pin that same string, and a user can paste the documented URL in full — so the base
 * can arrive already carrying any suffix of our own path. `normalizeBaseUrl` has
 * already dropped a trailing `/vN`; drop whatever of `/zen/go`, `/vN` and `/usage`
 * remains, or the path would be appended to itself.
 */
function endpointOrigin(value: unknown): string {
  const base = normalizeBaseUrl(value) ?? DEFAULT_BASE_URL
  return base.replace(/\/zen\/go(?:\/v\d+)?(?:\/usage)?$/i, '')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * The Go plan names its windows by cadence. `rolling` is the 5-hour window,
 * `weekly` the 7-day one, and `monthly` the 30-day one — the same canonical ids
 * the status line already orders and localises.
 */
const WINDOW_IDS: ReadonlyArray<readonly [key: string, id: string]> = [
  ['rolling', '5h'],
  ['weekly', '7d'],
  ['monthly', '30d'],
]

function parseUsage(payload: unknown): UsageReading {
  const root = asRecord(payload)
  if (root === undefined) throw new SourceError('parse', 'OpenCode usage response is not a JSON object')

  // The live endpoint answers `{ usage: { … } }` at the root, but the documented
  // shape wraps it in `data`. Accept both rather than guessing which is current.
  const usage = asRecord(root.usage) ?? asRecord(asRecord(root.data)?.usage)
  if (usage === undefined) throw new SourceError('parse', 'OpenCode usage response carries no usage windows')

  const windows: QuotaWindow[] = []
  for (const [key, id] of WINDOW_IDS) {
    const entry = asRecord(usage[key])
    if (entry === undefined) continue

    // `percent` is already a 0..100 used percentage (the live endpoint reports `0`
    // and `18`), so it is clamped rather than run through `normalizePercent`: a
    // literal `1` must mean one percent, not a whole window.
    const percent = toFiniteNumber(entry.percent)
    if (percent === undefined) continue

    const usedPercent = clampPercent(percent)
    const resetsAt = normalizeResetAt(entry.resetsAt)
    windows.push(resetsAt === undefined ? { id, usedPercent } : { id, usedPercent, resetsAt })
  }

  if (windows.length === 0) throw new SourceError('parse', 'OpenCode usage response contains no usable quota window')
  return { balances: [], windows }
}

export const opencode: UsageSource = {
  id: 'opencode',
  displayName: 'OpenCode Zen Go',
  modes: ['coding-plan'],
  credentialRefs: () => ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'],
  defaultBaseUrl: () => DEFAULT_BASE_URL,

  request(input: RequestInput): UsageRequest {
    return {
      url: `${endpointOrigin(input.baseUrl)}${QUOTA_PATH}`,
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        accept: 'application/json',
        'user-agent': BROWSER_USER_AGENT,
      },
    }
  },

  parse(payload: unknown, _mode: UsageMode): UsageReading {
    return parseUsage(payload)
  },
}
