/** Shared normalization helpers for provider payloads. */

/** Numbers and numeric strings to a finite number; anything else is absent. */
export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** Clamp to 0..100 and round to one decimal. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10))
}

/**
 * Percentages arrive in two conventions: 0..1 fractions and 0..100 percentages.
 * Values `<= 1` are read as fractions (so a literal "1" means 100%), anything
 * larger is read as a percentage. Invalid or negative input yields `null`.
 */
export function normalizePercent(value: unknown): number | null {
  const parsed = toFiniteNumber(value)
  if (parsed === undefined || parsed < 0) return null
  return clampPercent(parsed <= 1 ? parsed * 100 : parsed)
}

function fromNumericInstant(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined
  // Anything above 1e12 is already milliseconds (1e12 ms is 2001-09-09).
  return value > 1e12 ? Math.round(value) : Math.round(value * 1000)
}

/**
 * Reset instants arrive as unix seconds, unix milliseconds, numeric strings or
 * ISO timestamps; all of them become epoch milliseconds. Missing or nonsense
 * values become `undefined` rather than a bogus date.
 */
export function normalizeResetAt(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const numeric = toFiniteNumber(trimmed)
      return numeric === undefined ? undefined : fromNumericInstant(numeric)
    }
    const parsed = Date.parse(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const numeric = toFiniteNumber(value)
  return numeric === undefined ? undefined : fromNumericInstant(numeric)
}

/** Trim whitespace, trailing slashes and a trailing `/vN` API version segment. */
export function normalizeBaseUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().replace(/\/+$/, '')
  if (trimmed === '') return undefined
  const withoutVersion = trimmed.replace(/\/v\d+$/i, '')
  return withoutVersion === '' ? undefined : withoutVersion
}
