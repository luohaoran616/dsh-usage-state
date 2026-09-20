import type { UsageMode, UsageReading } from '../../shared/types.ts'
import { normalizeBaseUrl, toFiniteNumber } from './normalize.ts'
import { SourceError, type RequestInput, type UsageRequest, type UsageSource } from './types.ts'

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const BALANCE_PATH = '/user/balance'

interface PickedBalance {
  amount: number
  currency: string
  granted?: number
  toppedUp?: number
}

/**
 * DeepSeek returns one entry per currency and the order is not stable, so a
 * fixed "first entry" read makes the displayed balance flip between the real
 * value and zero. Rule: prefer an entry with a positive balance, prefer CNY
 * among equals (the open platform's primary currency), and fall back to CNY or
 * the first entry so the result never depends on response ordering.
 */
function pickBalanceInfo(infos: unknown): PickedBalance | undefined {
  if (!Array.isArray(infos)) return undefined

  const entries: PickedBalance[] = []
  for (const raw of infos) {
    if (raw === null || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const granted = toFiniteNumber(entry.granted_balance)
    const toppedUp = toFiniteNumber(entry.topped_up_balance)
    entries.push({
      amount: toFiniteNumber(entry.total_balance) ?? 0,
      currency: typeof entry.currency === 'string' ? entry.currency : '',
      ...(granted === undefined ? {} : { granted }),
      ...(toppedUp === undefined ? {} : { toppedUp }),
    })
  }
  if (entries.length === 0) return undefined

  const cnyOf = (list: PickedBalance[]): PickedBalance | undefined =>
    list.find(entry => entry.currency.toUpperCase() === 'CNY')

  const funded = entries.filter(entry => entry.amount > 0)
  return cnyOf(funded) ?? funded[0] ?? cnyOf(entries) ?? entries[0]
}

/** DeepSeek official API: balance only — the platform has no coding plan. */
export const deepseek: UsageSource = {
  id: 'deepseek',
  displayName: 'DeepSeek',
  modes: ['api'],
  credentialRefs: () => ['DEEPSEEK_API_KEY'],
  defaultBaseUrl: () => DEFAULT_BASE_URL,

  request(input: RequestInput): UsageRequest {
    const base = normalizeBaseUrl(input.baseUrl) ?? DEFAULT_BASE_URL
    return {
      url: `${base}${BALANCE_PATH}`,
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        accept: 'application/json',
      },
    }
  },

  parse(payload: unknown, _mode: UsageMode): UsageReading {
    const root = payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined
    const picked = root === undefined ? undefined : pickBalanceInfo(root.balance_infos)
    if (picked === undefined) {
      throw new SourceError('parse', 'DeepSeek balance response contains no usable balance_infos')
    }
    return {
      balances: [
        {
          amount: picked.amount,
          currency: picked.currency,
          ...(picked.granted === undefined ? {} : { granted: picked.granted }),
          ...(picked.toppedUp === undefined ? {} : { toppedUp: picked.toppedUp }),
        },
      ],
      windows: [],
    }
  },
}
