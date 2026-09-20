import type { UsageMode, UsageReading } from '../../shared/types.ts'
import { normalizeBaseUrl, normalizeResetAt, toFiniteNumber } from './normalize.ts'
import { SourceError, type RequestInput, type UsageRequest, type UsageSource } from './types.ts'

/**
 * Template for a new data source. Copy to `<id>.ts`, fill in the four marked
 * places, and register it in `src/host/sources/index.ts` — nothing else in the
 * plugin needs to change: the settings page lists whatever the registry exposes,
 * and `resolveTargets` derives polling targets from it.
 *
 * Rules that keep adapters honest (see docs/adapters.md):
 *  - `parse` is PURE. No network, no clock reads, no throws other than `SourceError`.
 *  - Tolerate what you do not recognise: unknown fields are ignored, missing
 *    optional fields are `undefined`, and a percentage of exactly `1` is a
 *    fraction only when the provider's documentation says so.
 *  - Never invent data. If the payload carries no usable reading, throw
 *    `new SourceError('parse', ...)` — the UI then shows a failure state instead
 *    of a wrong number.
 */

const DEFAULT_BASE_URL = 'https://example.invalid'
const PATH = '/v1/usage'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export const template: UsageSource = {
  id: 'template',
  displayName: 'Example service',
  // Only the modes this service can actually answer for. DeepSeek-style pay-as-you-go
  // services are `['api']`; coding-plan-only services are `['coding-plan']`.
  modes: ['api'] satisfies UsageMode[],

  // Probed in this order, after any explicit `apiKeyRef` from the settings and any
  // `apiKeyEnv` declared for a matching DSH provider.
  credentialRefs: () => ['EXAMPLE_API_KEY'],

  // The endpoint used when the user configures no override. Omit (and set
  // `requiresBaseUrl`) for self-hosted services.
  defaultBaseUrl: () => DEFAULT_BASE_URL,

  request(input: RequestInput): UsageRequest {
    const base = normalizeBaseUrl(input.baseUrl) ?? DEFAULT_BASE_URL
    return {
      url: `${base}${PATH}`,
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        accept: 'application/json',
      },
    }
  },

  parse(payload: unknown, _mode: UsageMode): UsageReading {
    const root = asRecord(payload)
    if (root === undefined) throw new SourceError('parse', 'example: response is not a JSON object')

    // Balance-shaped services return an amount plus a currency.
    const amount = toFiniteNumber(root.balance)
    if (amount !== undefined) {
      const currency = typeof root.currency === 'string' ? root.currency : 'USD'
      return { balances: [{ amount, currency }], windows: [] }
    }

    // Coding-plan-shaped services return rolling windows. `id` should be the
    // canonical key the UI knows (`5h`, `1d`, `7d`); the browser localises the label.
    const usedPercent = toFiniteNumber(root.used_percent)
    const resetsAt = normalizeResetAt(root.resets_at)
    if (usedPercent !== undefined) {
      return {
        balances: [],
        windows: [resetsAt === undefined ? { id: '5h', usedPercent } : { id: '5h', usedPercent, resetsAt }],
      }
    }

    throw new SourceError('parse', 'example: response carries no balance or quota window')
  },
}
