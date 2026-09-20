import { formatAge, formatCountdown, type StatusSegment } from '../shared/display.ts'
import type { UsageStateKey } from './locales.ts'

/** The subset of the platform translate function this module needs. */
export interface Translate {
  (key: string, params?: Record<string, unknown>): string
}

/**
 * Window ids are data, not copy: `5h` is the same in every language. When the
 * dictionary has no entry the raw id is shown rather than the lookup key.
 */
export function windowLabel(id: string, t: Translate): string {
  const key = `window.${id}`
  const text = t(key)
  return text === key ? id : text
}

export type StatusPart =
  | { kind: 'label'; text: string; stale: boolean }
  | { kind: 'age'; text: string }
  | { kind: 'balance'; text: string; currency: string }
  | { kind: 'window'; id: string; text: string; percent: string; severity: 'normal' | 'warn' | 'critical'; bar?: string; countdown?: string }
  | {
      kind: 'state'
      state: 'loading' | 'unconfigured' | 'unsupported' | 'needs-endpoint' | 'error'
      text: string
      errorKind?: string
      errorDetail?: string
    }

/** Visual separator between the parts of one status line. */
export const SEPARATOR = '·'

/**
 * Turn the host's language-neutral segments into render-ready parts. Everything
 * that reads as prose comes from the dictionary; numbers and window ids pass
 * through untouched.
 */
export function statusParts(input: { segments: readonly StatusSegment[]; t: Translate; now: number }): StatusPart[] {
  const { segments, t, now } = input
  const parts: StatusPart[] = []

  for (const segment of segments) {
    switch (segment.kind) {
      case 'label': {
        parts.push({ kind: 'label', text: segment.text, stale: segment.stale === true })
        if (segment.staleSince !== undefined) {
          parts.push({ kind: 'age', text: t('staleAgo', { age: formatAge(segment.staleSince, now) }) })
        }
        break
      }
      case 'balance':
        parts.push({ kind: 'balance', text: segment.amount, currency: segment.currency })
        break
      case 'window': {
        const countdown = formatCountdown(segment.resetsAt, now)
        parts.push({
          kind: 'window',
          id: segment.windowId,
          text: `${windowLabel(segment.windowId, t)} ${segment.percent}`,
          percent: segment.percent,
          severity: segment.severity,
          ...(countdown === undefined ? {} : { countdown }),
          ...(segment.bar === undefined ? {} : { bar: segment.bar }),
        })
        break
      }
      case 'state':
        parts.push({
          kind: 'state',
          state: segment.state,
          text: t(`state.${segment.state}` as UsageStateKey),
          ...(segment.errorKind === undefined ? {} : { errorKind: segment.errorKind }),
          ...(segment.errorDetail === undefined ? {} : { errorDetail: segment.errorDetail }),
        })
        break
    }
  }

  return parts
}

/** One-line rendering, used by the tests and by any place that needs plain text. */
export function partsToText(parts: readonly StatusPart[]): string {
  return parts
    .map(part => {
      if (part.kind === 'window') {
        const suffix = part.countdown === undefined ? '' : ` (${part.countdown})`
        return `${part.text}${suffix}`
      }
      return part.text
    })
    .join(` ${SEPARATOR} `)
}
