import { formatAge, formatBalance, formatCountdown, type StatusSegment } from '../shared/display.ts'
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
  | { kind: 'label'; text: string; stale: boolean; tooltip?: string }
  | { kind: 'age'; text: string; tooltip?: string }
  | { kind: 'balance'; text: string; currency: string; tooltip?: string }
  | {
      kind: 'window'
      id: string
      text: string
      percent: string
      severity: 'normal' | 'warn' | 'critical'
      bar?: string
      countdown?: string
      tooltip?: string
    }
  | {
      kind: 'state'
      state: 'loading' | 'unconfigured' | 'unsupported' | 'needs-endpoint' | 'error'
      text: string
      errorKind?: string
      errorDetail?: string
      tooltip?: string
    }

/** Visual separator between the parts of one status line. */
export const SEPARATOR = '·'

/**
 * Turn the host's language-neutral segments into render-ready parts. Everything
 * that reads as prose comes from the dictionary; numbers and window ids pass
 * through untouched.
 */
export interface StatusPartsInput {
  segments: readonly StatusSegment[]
  t: Translate
  now: number
  /** Data-source display name, for the tooltip. */
  sourceLabel?: string
  /** Already-localized mode name, for the tooltip. */
  modeLabel?: string
}

/** Join the pieces of a tooltip, dropping the ones that do not apply. */
function tooltipOf(pieces: readonly (string | undefined)[]): string | undefined {
  const present = pieces.filter((piece): piece is string => piece !== undefined && piece !== '')
  return present.length === 0 ? undefined : present.join(' · ')
}

function localTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString()
}

/**
 * Turn the host's language-neutral segments into render-ready parts.
 *
 * Every part also carries a tooltip: the line has room for one number per window,
 * while the useful context (which source and mode this reading belongs to, when it
 * was last refreshed, when a window resets, how a balance splits) does not fit.
 */
export function statusParts(input: StatusPartsInput): StatusPart[] {
  const { segments, t, now, sourceLabel, modeLabel } = input
  const context = tooltipOf([
    sourceLabel === undefined ? undefined : t('tipSource', { source: sourceLabel }),
    modeLabel === undefined ? undefined : t('tipMode', { mode: modeLabel }),
  ])
  const parts: StatusPart[] = []

  for (const segment of segments) {
    switch (segment.kind) {
      case 'label': {
        const staleHint = segment.stale === true ? t('staleHint') : undefined
        const refreshHint =
          segment.staleSince === undefined
            ? undefined
            : t('tipUpdated', { age: formatAge(segment.staleSince, now) })
        parts.push({
          kind: 'label',
          text: segment.text,
          stale: segment.stale === true,
          ...(tooltipOf([staleHint, refreshHint, context]) === undefined
            ? {}
            : { tooltip: tooltipOf([staleHint, refreshHint, context]) as string }),
        })
        if (segment.staleSince !== undefined) {
          parts.push({
            kind: 'age',
            text: t('staleAgo', { age: formatAge(segment.staleSince, now) }),
            ...(staleHint === undefined ? {} : { tooltip: staleHint }),
          })
        }
        break
      }
      case 'balance': {
        const split =
          segment.granted === undefined && segment.toppedUp === undefined
            ? undefined
            : t('tipBalanceSplit', {
                granted: segment.granted === undefined ? '—' : String(segment.granted),
                toppedUp: segment.toppedUp === undefined ? '—' : String(segment.toppedUp),
              })
        parts.push({
          kind: 'balance',
          text: segment.amount,
          currency: segment.currency,
          ...(tooltipOf([split, context]) === undefined ? {} : { tooltip: tooltipOf([split, context]) as string }),
        })
        break
      }
      case 'window': {
        const countdown = formatCountdown(segment.resetsAt, now)
        const resetHint = segment.resetsAt === undefined ? undefined : t('tipResets', { time: localTime(segment.resetsAt) })
        parts.push({
          kind: 'window',
          id: segment.windowId,
          text: `${windowLabel(segment.windowId, t)} ${segment.percent}`,
          percent: segment.percent,
          severity: segment.severity,
          ...(countdown === undefined ? {} : { countdown }),
          ...(segment.bar === undefined ? {} : { bar: segment.bar }),
          ...(tooltipOf([resetHint, context]) === undefined ? {} : { tooltip: tooltipOf([resetHint, context]) as string }),
        })
        break
      }
      case 'state': {
        const reason =
          segment.errorKind === undefined
            ? undefined
            : segment.errorDetail === undefined
              ? t(`error.${segment.errorKind}`)
              : `${t(`error.${segment.errorKind}`)}: ${segment.errorDetail}`
        parts.push({
          kind: 'state',
          state: segment.state,
          text: t(`state.${segment.state}` as UsageStateKey),
          ...(segment.errorKind === undefined ? {} : { errorKind: segment.errorKind }),
          ...(segment.errorDetail === undefined ? {} : { errorDetail: segment.errorDetail }),
          ...(tooltipOf([reason, context]) === undefined ? {} : { tooltip: tooltipOf([reason, context]) as string }),
        })
        break
      }
    }
  }

  return parts
}

/**
 * The same parts, reduced to what fits the completed-turn action strip: one line
 * shared with the turn's icons and the platform's own usage/time pills.
 *
 * The provider label becomes the icon, the stale age is dropped (the icon keeps the
 * tooltip), and each window keeps only its percentage — the countdown, the progress
 * bar and every other detail stay available in the tooltip.
 */
export function compactParts(parts: readonly StatusPart[]): StatusPart[] {
  const compact: StatusPart[] = []
  for (const part of parts) {
    if (part.kind === 'label' || part.kind === 'age') continue
    if (part.kind === 'window') {
      compact.push({
        kind: 'window',
        id: part.id,
        text: part.text,
        percent: part.percent,
        severity: part.severity,
        ...(part.tooltip === undefined ? {} : { tooltip: part.tooltip }),
      })
      continue
    }
    compact.push(part)
  }
  return compact
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
