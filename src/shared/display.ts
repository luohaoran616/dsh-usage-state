import type { DisplayConfig, ModelMode, UsageStateConfig } from './config.ts'
import type { BalanceAmount, SnapshotError, UsageMode, UsageSnapshot } from './types.ts'

/**
 * Plain description of a data source, produced host-side and shipped to the
 * browser. The browser half must not import host adapters (that would drag Node
 * builtins into the client bundle), so everything it needs about a source —
 * which modes exist, whether an endpoint is required, which credential refs are
 * probed — travels as data.
 */
export interface SourceCatalogEntry {
  id: string
  displayName: string
  modes: UsageMode[]
  requiresBaseUrl: boolean
  defaultBaseUrl: Partial<Record<UsageMode, string>>
  credentialRefs: Partial<Record<UsageMode, string[]>>
}

export type SourceCatalog = SourceCatalogEntry[]

/** What the plugin knows about the model a session is currently using. */
export type ModelStatus =
  | { kind: 'hidden' }
  | { kind: 'unconfigured' }
  | { kind: 'unsupported'; sourceId: string; mode: ModelMode }
  | { kind: 'ready'; key: string; sourceId: string; mode: UsageMode }

export type Severity = 'normal' | 'warn' | 'critical'

export type StatusSegment =
  | { kind: 'label'; text: string; stale?: boolean }
  | { kind: 'balance'; amount: string; currency: string }
  | { kind: 'window'; windowId: string; percent: string; severity: Severity; resetsAt?: number; bar?: string }
  | { kind: 'state'; state: 'loading' | 'unconfigured' | 'unsupported' | 'error'; errorKind?: SnapshotError['kind'] }

const CURRENCY_SYMBOLS: Record<string, string> = { CNY: '¥', USD: '$' }

const PROGRESS_WIDTH = 8

/** `¥66.28`, `$6.80`, `EUR 1.50`; an unknown code keeps its numeric form. */
export function formatBalance(balance: BalanceAmount): string {
  const amount = balance.amount.toFixed(2)
  const currency = balance.currency.trim().toUpperCase()
  if (currency === '') return amount
  const symbol = CURRENCY_SYMBOLS[currency]
  return symbol === undefined ? `${currency} ${amount}` : `${symbol}${amount}`
}

/** One decimal only when it carries information: `42%`, `42.5%`. */
export function formatPercent(percent: number): string {
  const rounded = Math.round(percent * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}

/** Compact, language-neutral remaining time: `5d`, `3d4h`, `4h12m`, `12m`, `45s`. */
export function formatCountdown(resetsAt: number | undefined, now: number): string | undefined {
  if (resetsAt === undefined) return undefined
  const seconds = Math.floor(Math.max(0, resetsAt - now) / 1000)

  const days = Math.floor(seconds / 86_400)
  if (days >= 1) {
    const hours = Math.floor((seconds % 86_400) / 3600)
    return hours === 0 ? `${days}d` : `${days}d${hours}h`
  }
  const hours = Math.floor(seconds / 3600)
  if (hours >= 1) return `${hours}h${Math.floor((seconds % 3600) / 60)}m`
  const minutes = Math.floor(seconds / 60)
  return minutes >= 1 ? `${minutes}m` : `${seconds}s`
}

export function progressBar(percent: number, width: number = PROGRESS_WIDTH): string {
  const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function severityOf(usedPercent: number, display: DisplayConfig): Severity {
  if (usedPercent >= display.thresholdCriticalPercent) return 'critical'
  if (usedPercent >= display.thresholdWarnPercent) return 'warn'
  return 'normal'
}

/**
 * Which reading belongs to the model a session is using. The user configures
 * models by hand, so an unknown model is "unconfigured" rather than a guess.
 */
export function resolveModelStatus(
  config: UsageStateConfig,
  provider: string,
  model: string,
  catalog: SourceCatalog,
): ModelStatus {
  const entry = config.models.find(candidate => candidate.provider === provider && candidate.model === model)
  if (entry === undefined) return { kind: 'unconfigured' }
  if (entry.mode === 'hidden') return { kind: 'hidden' }
  if (entry.sourceId === null) return { kind: 'unconfigured' }

  const source = catalog.find(candidate => candidate.id === entry.sourceId)
  if (source === undefined) return { kind: 'unconfigured' }
  if (!source.modes.includes(entry.mode)) {
    return { kind: 'unsupported', sourceId: entry.sourceId, mode: entry.mode }
  }

  return { kind: 'ready', key: `${entry.sourceId}:${entry.mode}`, sourceId: entry.sourceId, mode: entry.mode }
}

export interface StatusInput {
  sourceLabel: string
  status: ModelStatus
  snapshot: UsageSnapshot | undefined
  display: DisplayConfig
  now: number
}

/**
 * The status line's content, as data: numbers formatted, states named, nothing
 * localized. The browser turns `state` and window ids into copy.
 *
 * A stale reading stays visible (with the label flagged) because hiding it would
 * look like "no usage"; a failure with no previous reading shows the error state
 * instead of a misleading zero.
 */
export function describeStatus(input: StatusInput): StatusSegment[] {
  const { status, snapshot, display, now } = input
  if (status.kind === 'hidden') return []
  if (status.kind === 'unconfigured') return [{ kind: 'state', state: 'unconfigured' }]
  if (status.kind === 'unsupported') return [{ kind: 'state', state: 'unsupported' }]

  const label: StatusSegment = snapshot?.stale === true
    ? { kind: 'label', text: input.sourceLabel, stale: true }
    : { kind: 'label', text: input.sourceLabel }

  if (snapshot === undefined) return [label, { kind: 'state', state: 'loading' }]

  if (snapshot.balances.length === 0 && snapshot.windows.length === 0) {
    return [
      label,
      snapshot.error === undefined ? { kind: 'state', state: 'loading' } : { kind: 'state', state: 'error', errorKind: snapshot.error.kind },
    ]
  }

  const segments: StatusSegment[] = [label]
  for (const balance of snapshot.balances) {
    segments.push({ kind: 'balance', amount: formatBalance(balance), currency: balance.currency })
  }
  for (const window of snapshot.windows) {
    const segment: StatusSegment = {
      kind: 'window',
      windowId: window.id,
      percent: formatPercent(window.usedPercent),
      severity: severityOf(window.usedPercent, display),
    }
    // A reset instant already in the past means the window rolled over and the
    // provider will report fresh numbers on the next poll — showing "0s" is noise.
    if (window.resetsAt !== undefined && window.resetsAt > now) segment.resetsAt = window.resetsAt
    if (display.progressBar) segment.bar = progressBar(window.usedPercent)
    segments.push(segment)
  }

  return segments
}
