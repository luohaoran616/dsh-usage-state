import { Fragment } from 'react'
import { IconDataOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

import { describeStatus, type ModelStatus, type Severity } from '../shared/display.ts'
import { resolveProvider } from '../shared/providers.ts'
import type { UsageStateConfig } from '../shared/config.ts'
import type { UsageStateSnapshotSource } from './status-source.ts'
import { compactParts, statusParts, SEPARATOR, type StatusPart } from './status-text.ts'
import { useNow, useSettingsValue, useStoreState } from './hooks.ts'
import type { ModelSelectionProjectionLike, SettingsSource, Translate } from './context.ts'
import type { StatusLineVariant } from './slots.ts'

export interface StatusLineProps {
  t: Translate
  variant: StatusLineVariant
  usageState: UsageStateSnapshotSource
  settings: SettingsSource<{ value: UsageStateConfig | undefined }>
  useProjection?: <T>(key: string) => T | undefined
}

const BASE_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
  lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

/** Matches the shipped stats row so this reads as its second line, not a stray block. */
const DOCK_STYLE = {
  ...BASE_STYLE,
  width: '100%',
  maxWidth: 'var(--dsh-chat-content-width)',
  margin: '0 auto',
  padding: '4px calc(var(--dsh-composer-side-clearance) + 16px) 0',
}

/**
 * The completed-turn mount point is the platform's action strip: a 28px row that
 * holds the turn's icons, its own token/time pills, and the timestamp.
 *
 * Our entry is placed between the copy and branch controls by the platform
 * (`MessageIconActions.extraActions`), which is not where a reading belongs, so
 * `order: 1` moves it to the end of that flex row instead. The label becomes an
 * icon and the countdown/progress bar drop out (see `compactParts`); every detail
 * stays in the tooltip.
 */
const ACTIONS_STYLE = {
  ...BASE_STYLE,
  order: 1,
  justifyContent: 'flex-end',
  fontSize: '12px',
}

const ICON_STYLE = { display: 'inline-flex', alignItems: 'center', color: 'var(--dsw-alias-label-tertiary)' }

const LABEL_STYLE = { color: 'var(--dsw-alias-label-tertiary)' }
const SEPARATOR_STYLE = { color: 'var(--dsw-alias-separator-primary, var(--dsw-alias-label-dimmed))' }

function severityColor(severity: Severity): string {
  if (severity === 'critical') return 'var(--dsw-alias-state-error-primary)'
  if (severity === 'warn') return 'var(--dsw-alias-state-warn-primary)'
  return 'var(--dsw-alias-label-secondary)'
}

/** Wrap one part in the platform tooltip when it has something more to say. */
function withTooltip(node: ReturnType<typeof renderPart>, tooltip: string | undefined, key: number) {
  if (tooltip === undefined) return node
  return (
    <Tooltip key={`tip-${key}`} label={tooltip} side="top">
      {node}
    </Tooltip>
  )
}

function renderPart(part: StatusPart, t: Translate, key: number) {
  switch (part.kind) {
    case 'label':
      return (
        <span key={key} style={LABEL_STYLE}>
          {part.stale ? '⚠ ' : ''}
          {part.text}
        </span>
      )
    case 'age':
      return (
        <span key={key} style={LABEL_STYLE}>
          {part.text}
        </span>
      )
    case 'balance':
      return (
        <span key={key} style={{ color: 'var(--dsw-alias-label-secondary)' }}>
          {part.text}
        </span>
      )
    case 'window':
      return (
        <span key={key} style={{ color: severityColor(part.severity) }}>
          {part.text}
          {part.countdown === undefined ? '' : ` (${part.countdown})`}
          {part.bar === undefined ? '' : ` ${part.bar}`}
        </span>
      )
    case 'state':
      return (
        <span key={key} style={LABEL_STYLE}>
          {part.text}
        </span>
      )
  }
}

/** Map a provider resolution onto what the line can say about it. */
function statusOf(resolution: ReturnType<typeof resolveProvider>): ModelStatus {
  switch (resolution.reason) {
    case 'hidden':
      return { kind: 'hidden' }
    case 'needs-endpoint':
      return { kind: 'needs-endpoint' }
    case 'unknown-source':
    case 'unsupported':
      return resolution.sourceId === null ? { kind: 'unconfigured' } : { kind: 'unsupported' }
    case 'auto':
    case 'configured': {
      if (resolution.key === undefined || resolution.sourceId === null || resolution.mode === null) {
        return { kind: 'unconfigured' }
      }
      return { kind: 'ready', key: resolution.key, sourceId: resolution.sourceId, mode: resolution.mode }
    }
  }
}

/** One read-only usage line: balance in API mode, 5h/7d quota in coding-plan mode. */
export function StatusLine(props: StatusLineProps) {
  const t = props.t
  const now = useNow(30_000)
  const state = useStoreState(props.usageState)
  const settings = useSettingsValue(props.settings)
  const config = settings.value

  const selection = props.useProjection?.<ModelSelectionProjectionLike>('modelSelection')
  const current = selection?.next ?? selection?.lastUsed ?? null
  // No model in play yet (a brand-new session): say nothing rather than "not configured".
  if (config === undefined || current === null) return null

  const status: ModelStatus = statusOf(resolveProvider({ provider: current.provider, config, catalog: state.catalog }))
  const snapshot = status.kind === 'ready' ? state.snapshots[status.key] : undefined
  const sourceLabel =
    status.kind === 'ready'
      ? (state.catalog.find(entry => entry.id === status.sourceId)?.displayName ?? status.sourceId)
      : ''

  const fullParts = statusParts({
    segments: describeStatus({ sourceLabel, status, snapshot, display: config.display, now }),
    t,
    now,
    ...(sourceLabel === '' ? {} : { sourceLabel }),
    ...(status.kind === 'ready'
      ? { modeLabel: status.mode === 'api' ? t('modeApi') : t('modeCodingPlan') }
      : {}),
  })
  if (fullParts.length === 0) return null

  const compact = props.variant === 'actions'
  const parts = compact ? compactParts(fullParts) : fullParts
  // The icon replaces the provider label, so it inherits that label's tooltip.
  const iconTooltip = fullParts.find(part => part.kind === 'label')?.tooltip

  return (
    <div data-usage-state={props.variant} style={compact ? ACTIONS_STYLE : DOCK_STYLE}>
      {compact
        ? withTooltip(
            <span style={ICON_STYLE}>
              <IconDataOutline16 size={16} />
            </span>,
            iconTooltip,
            -1,
          )
        : null}
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <span style={SEPARATOR_STYLE} aria-hidden="true">
              {SEPARATOR}
            </span>
          ) : null}
          {withTooltip(renderPart(part, t, index), part.tooltip, index)}
        </Fragment>
      ))}
    </div>
  )
}
