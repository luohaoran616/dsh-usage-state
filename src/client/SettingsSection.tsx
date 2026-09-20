import { useEffect, useState } from 'react'
import { Button, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'

import { configureModel, reorderModels, type ModelRow } from './model-rows.ts'
import { buildModelRows } from './model-rows.ts'
import { rowKey } from './model-rows.ts'
import { useSettingsValue, useStoreState } from './hooks.ts'
import type { UsageStateClientStore } from './store.ts'
import type { CredentialsRemoteLike, SettingsScopeLike, Translate } from './context.ts'
import type { ModelMode, UsageStateConfig } from '../shared/config.ts'
import { normalizeConfig } from '../shared/config.ts'

export interface SettingsSectionProps {
  close: () => void
  t: Translate
  usageState: UsageStateClientStore
  settings: SettingsScopeLike<UsageStateConfig>
  credentials: CredentialsRemoteLike | undefined
}

const CARD = {
  border: '1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l3))',
  borderRadius: '12px',
  background: 'var(--dsw-alias-bg-layer-3)',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '10px',
}

const ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap' as const,
  minWidth: 0,
}

const MUTED = { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px' }

const MODE_ORDER: ModelMode[] = ['api', 'coding-plan', 'hidden']

function modeLabel(mode: ModelMode, t: Translate): string {
  if (mode === 'api') return t('modeApi')
  if (mode === 'coding-plan') return t('modeCodingPlan')
  return t('modeHidden')
}

/**
 * A text field that keeps a local draft and writes once, on blur or Enter.
 * Committing on every keystroke would mean one settings revision per character.
 */
function DraftInput(props: {
  value: string
  type?: string
  placeholder?: string
  disabled?: boolean
  width?: string
  onCommit: (next: string) => void
}) {
  const [draft, setDraft] = useState(props.value)
  const [editing, setEditing] = useState(false)
  const shown = editing ? draft : props.value

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next !== props.value.trim()) props.onCommit(next)
  }

  return (
    <Input
      type={props.type ?? 'text'}
      value={shown}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onChange={event => {
        setEditing(true)
        setDraft((event.target as HTMLInputElement).value)
      }}
      onBlur={commit}
      onKeyDown={event => {
        if ((event as { key?: string }).key === 'Enter') (event.target as HTMLInputElement).blur()
      }}
      style={{ maxWidth: props.width ?? '280px' }}
    />
  )
}

/** One credential panel: status, write and clear, all through the platform's credential RPC. */
function CredentialPanel(props: {
  t: Translate
  refs: readonly string[]
  status: { configured: boolean; source?: string; ref?: string } | undefined
  writable: boolean
  credentials: CredentialsRemoteLike | undefined
  onChanged: () => void
}) {
  const { t } = props
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState<string | undefined>(undefined)
  const configuredRef = props.status?.ref ?? props.refs[0]

  const save = async () => {
    if (props.credentials === undefined || configuredRef === undefined || draft.trim() === '') return
    const result = await props.credentials.set(configuredRef, draft.trim())
    if (!result.ok) {
      setNote(t('credentialFailed', { message: result.error.message }))
      return
    }
    setDraft('')
    setNote(t('credentialSaved'))
    props.onChanged()
  }

  const clear = async () => {
    if (props.credentials === undefined || configuredRef === undefined) return
    const result = await props.credentials.unset(configuredRef)
    if (!result.ok) {
      setNote(t('credentialFailed', { message: result.error.message }))
      return
    }
    setNote(t('credentialSaved'))
    props.onChanged()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={ROW}>
        <span style={MUTED}>{t('credential')}</span>
        {props.status?.configured === true ? (
          <Tag tone="success">{t('credentialConfigured', { source: props.status.source ?? configuredRef ?? '' })}</Tag>
        ) : (
          <Tag tone="neutral">{t('credentialMissing')}</Tag>
        )}
        {props.writable ? null : <span style={MUTED}>{t('credentialLocked')}</span>}
      </div>
      <div style={ROW}>
        <Input
          type="password"
          autoComplete="off"
          value={draft}
          disabled={!props.writable || props.credentials === undefined}
          placeholder={t('credentialPlaceholder')}
          onChange={event => setDraft((event.target as HTMLInputElement).value)}
          style={{ maxWidth: '280px' }}
        />
        <Button size="sm" variant="primary" disabled={draft.trim() === ''} onClick={() => void save()}>
          {t('credentialSave')}
        </Button>
        <Button size="sm" variant="outline" disabled={props.status?.configured !== true} onClick={() => void clear()}>
          {t('credentialClear')}
        </Button>
      </div>
      <span style={MUTED}>{note ?? t('credentialHint')}</span>
    </div>
  )
}

/**
 * The plugin's settings page: models (tri-state + order), the data sources they
 * use, and display preferences. Writes go through the platform settings scope as
 * path ops, so a concurrent edit elsewhere cannot silently clobber other fields.
 */
export function SettingsSection(props: SettingsSectionProps) {
  const { t } = props
  const snapshot = useSettingsValue(props.settings)
  const state = useStoreState(props.usageState)

  // The model list only exists on the host's side of the RPC, so ask for it on mount.
  useEffect(() => {
    void props.usageState.refreshModels()
    void props.usageState.refreshCredentials()
  }, [props.usageState])

  if (snapshot.status === 'unavailable') {
    return <p style={MUTED}>{t('unavailable')}</p>
  }

  const config = normalizeConfig(snapshot.value ?? {})
  const rows: ModelRow[] = buildModelRows({ models: state.models, config, catalog: state.catalog })
  const configured = rows.filter(row => !row.unconfigured)
  const available = rows.filter(row => row.unconfigured)

  const writeModels = (models: UsageStateConfig['models']) => {
    void props.settings.mutate([{ op: 'set', path: ['models'], value: models }])
  }
  const writeField = (path: string[], value: unknown) => {
    void props.settings.mutate([{ op: 'set', path, value }])
  }
  const clearField = (path: string[]) => {
    void props.settings.mutate([{ op: 'unset', path }])
  }

  const setMode = (row: ModelRow, mode: ModelMode) => {
    writeModels(configureModel(config.models, { provider: row.provider, model: row.model, sourceId: row.sourceId, mode }))
  }
  const move = (row: ModelRow, delta: number) => {
    const next = reorderModels(config.models, row.key, delta)
    if (next !== undefined) writeModels(next)
  }

  const renderRow = (row: ModelRow, index: number, list: ModelRow[]) => (
    <div key={row.key} style={{ ...ROW, justifyContent: 'space-between' }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {row.name} <span style={MUTED}>{row.providerName}</span>
      </span>
      <span style={ROW}>
        <Button size="sm" variant="ghost" aria-label={t('moveUp')} disabled={index === 0} onClick={() => move(row, -1)}>
          ↑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('moveDown')}
          disabled={index === list.length - 1}
          onClick={() => move(row, 1)}
        >
          ↓
        </Button>
        {MODE_ORDER.filter(mode => row.modes.includes(mode)).map(mode => (
          <Button
            key={mode}
            size="sm"
            variant={row.mode === mode ? 'primary' : 'outline'}
            disabled={!row.modes.includes(mode)}
            title={row.modes.includes(mode) ? undefined : t('modeUnsupported')}
            onClick={() => setMode(row, mode)}
          >
            {modeLabel(mode, t)}
          </Button>
        ))}
      </span>
    </div>
  )

  // One panel per data source actually in use, so the page stays short.
  const usedSources = [...new Set(configured.filter(row => row.mode !== 'hidden' && row.sourceId !== null).map(row => row.sourceId as string))]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '760px' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h3 style={{ margin: 0 }}>{t('title')}</h3>
        <p style={{ ...MUTED, margin: 0 }}>{t('intro')}</p>
        <div style={ROW}>
          <Button size="sm" variant="outline" onClick={() => void props.usageState.refresh(true)}>
            {t('refreshNow')}
          </Button>
          <span style={MUTED}>
            {state.checkedAt === undefined
              ? t('neverChecked')
              : t('lastChecked', { time: new Date(state.checkedAt).toLocaleTimeString() })}
          </span>
          {state.error === undefined ? null : <span style={MUTED}>{t('refreshFailed', { message: state.error })}</span>}
          {state.modelsError === undefined ? null : <span style={MUTED}>{state.modelsError}</span>}
        </div>
      </header>

      <section style={CARD}>
        <strong>{t('sectionModels')}</strong>
        <span style={MUTED}>{t('sectionModelsHint')}</span>
        {configured.length === 0 ? <span style={MUTED}>{t('empty')}</span> : configured.map((row, index) => renderRow(row, index, configured))}
        {available.length === 0 ? null : (
          <>
            <span style={MUTED}>{t('unconfiguredModel')}</span>
            {available.map((row, index) => renderRow(row, index, available))}
          </>
        )}
      </section>

      {usedSources.length === 0 ? null : (
        <section style={CARD}>
          <strong>{t('sectionSources')}</strong>
          {usedSources.map(sourceId => {
            const entry = state.catalog.find(candidate => candidate.id === sourceId)
            const override = config.sources[sourceId] ?? {}
            const mode = configured.find(row => row.sourceId === sourceId && row.mode !== 'hidden')?.mode
            const status =
              mode === undefined || mode === 'hidden' ? undefined : state.credentials[`${sourceId}:${mode}`]
            const refs = (mode === undefined || mode === 'hidden' ? [] : (entry?.credentialRefs[mode] ?? [])) as string[]
            return (
              <div key={sourceId} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={ROW}>
                  <strong style={{ fontSize: '13px' }}>{entry?.displayName ?? sourceId}</strong>
                  {entry?.requiresBaseUrl === true && override.baseUrl === undefined ? (
                    <Tag tone="warning">{t('baseUrlRequired')}</Tag>
                  ) : null}
                </div>
                <div style={ROW}>
                  <span style={MUTED}>{t('baseUrl')}</span>
                  <Input
                    value={override.baseUrl ?? ''}
                    placeholder={entry?.defaultBaseUrl[mode as 'api' | 'coding-plan'] ?? t('baseUrlPlaceholder')}
                    onChange={event => {
                      const value = (event.target as HTMLInputElement).value.trim()
                      if (value === '') clearField(['sources', sourceId, 'baseUrl'])
                      else writeField(['sources', sourceId, 'baseUrl'], value)
                    }}
                    style={{ maxWidth: '320px' }}
                  />
                </div>
                <div style={ROW}>
                  <span style={MUTED}>{t('apiKeyRef')}</span>
                  <DraftInput
                    value={override.apiKeyRef ?? ''}
                    width="220px"
                    onCommit={value => {
                      if (value === '') clearField(['sources', sourceId, 'apiKeyRef'])
                      else writeField(['sources', sourceId, 'apiKeyRef'], value)
                    }}
                  />
                  <span style={MUTED}>{t('apiKeyRefHint')}</span>
                </div>
                <CredentialPanel
                  t={t}
                  refs={refs}
                  status={status}
                  writable={status?.writable !== false}
                  credentials={props.credentials}
                  onChanged={() => void props.usageState.refreshCredentials()}
                />
              </div>
            )
          })}
        </section>
      )}

      <section style={CARD}>
        <strong>{t('sectionDisplay')}</strong>
        <div style={ROW}>
          <span style={MUTED}>{t('thresholdWarn')}</span>
          <DraftInput
            type="number"
            value={String(config.display.thresholdWarnPercent)}
            width="90px"
            onCommit={value => writeField(['display', 'thresholdWarnPercent'], Number(value))}
          />
          <span style={MUTED}>{t('thresholdCritical')}</span>
          <DraftInput
            type="number"
            value={String(config.display.thresholdCriticalPercent)}
            width="90px"
            onCommit={value => writeField(['display', 'thresholdCriticalPercent'], Number(value))}
          />
        </div>
        <div style={ROW}>
          <span style={MUTED}>{t('intervalMinutes')}</span>
          <DraftInput
            type="number"
            value={String(config.refresh.intervalMinutes)}
            width="90px"
            onCommit={value => writeField(['refresh', 'intervalMinutes'], Number(value))}
          />
        </div>
        <Switch
          checked={config.display.progressBar}
          label={t('progressBar')}
          onChange={next => writeField(['display', 'progressBar'], next)}
        />
      </section>

      <div style={ROW}>
        <Button size="sm" variant="ghost" onClick={props.close}>
          {t('close')}
        </Button>
      </div>
    </div>
  )
}

export { rowKey }
