import { Fragment } from 'react'

import { describeStatus, resolveModelStatus, type ModelStatus, type Severity } from '../shared/display.ts'
import type { UsageStateConfig } from '../shared/config.ts'
import type { UsageStateSnapshotSource } from './status-source.ts'
import { statusParts, SEPARATOR, type StatusPart } from './status-text.ts'
import { useNow, useSettingsValue, useStoreState } from './hooks.ts'
import type { ModelSelectionProjectionLike, SettingsSource, Translate } from './context.ts'

export interface StatusLineProps {
  t: Translate
  variant: 'dock' | 'turnTail'
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

const TURN_TAIL_STYLE = {
  ...BASE_STYLE,
  justifyContent: 'flex-start',
  padding: '2px 0 0',
  fontSize: '12px',
}

const LABEL_STYLE = { color: 'var(--dsw-alias-label-tertiary)' }
const SEPARATOR_STYLE = { color: 'var(--dsw-alias-separator-primary, var(--dsw-alias-label-dimmed))' }

function severityColor(severity: Severity): string {
  if (severity === 'critical') return 'var(--dsw-alias-state-error-primary)'
  if (severity === 'warn') return 'var(--dsw-alias-state-warn-primary)'
  return 'var(--dsw-alias-label-secondary)'
}

function renderPart(part: StatusPart, t: Translate, key: number) {
  switch (part.kind) {
    case 'label':
      return (
        <span key={key} style={LABEL_STYLE} title={part.stale ? t('staleHint') : undefined}>
          {part.stale ? '⚠ ' : ''}
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
        <span key={key} style={LABEL_STYLE} title={part.errorKind === undefined ? undefined : t(`error.${part.errorKind}`)}>
          {part.text}
        </span>
      )
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

  const status: ModelStatus = resolveModelStatus(config, current.provider, current.model, state.catalog)
  const snapshot = status.kind === 'ready' ? state.snapshots[status.key] : undefined
  const sourceLabel =
    status.kind === 'ready'
      ? (state.catalog.find(entry => entry.id === status.sourceId)?.displayName ?? status.sourceId)
      : ''

  const parts = statusParts({
    segments: describeStatus({ sourceLabel, status, snapshot, display: config.display, now }),
    t,
    now,
  })
  if (parts.length === 0) return null

  return (
    <div data-usage-state={props.variant} style={props.variant === 'dock' ? DOCK_STYLE : TURN_TAIL_STYLE}>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <span style={SEPARATOR_STYLE} aria-hidden="true">
              {SEPARATOR}
            </span>
          ) : null}
          {renderPart(part, t, index)}
        </Fragment>
      ))}
    </div>
  )
}
