import { useEffect, useState } from 'react'
import { Button, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'

import { buildProviderRows, reorderProviders, setProviderMode, type ProviderRow } from './provider-rows.ts'
import { useSettingsValue, useStoreState } from './hooks.ts'
import type { UsageStateClientSource } from './status-source.ts'
import type { CredentialsRemoteLike, SettingsScopeLike, Translate } from './context.ts'
import type { CredentialCandidate, CredentialDescription } from '../shared/rpc.ts'
import { normalizeConfig, type ProviderMode, type UsageStateConfig } from '../shared/config.ts'
import type { SourceCatalog } from '../shared/display.ts'
import type { UsageMode } from '../shared/types.ts'

export interface SettingsSectionProps {
  close: () => void
  t: Translate
  usageState: UsageStateClientSource
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

/** Models are listed for orientation only, so the line stays short. */
const MAX_MODELS_SHOWN = 6

function modeLabel(mode: ProviderMode, t: Translate): string {
  if (mode === 'api') return t('modeApi')
  if (mode === 'coding-plan') return t('modeCodingPlan')
  if (mode === 'hidden') return t('modeHidden')
  return t('modeAuto')
}

function windowModeLabel(mode: UsageMode, t: Translate): string {
  return modeLabel(mode, t)
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

/**
 * Credential status and writes for one account. The candidate names are shown on
 * purpose: the user has to know what to call the environment variable or stored
 * credential — and when DSH already provides one, there is nothing to do here.
 */
function CredentialPanel(props: {
  t: Translate
  refs: readonly string[]
  description: CredentialDescription | undefined
  credentials: CredentialsRemoteLike | undefined
  onChanged: () => void
}) {
  const { t } = props
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState<string | undefined>(undefined)
  const candidates = props.description?.candidates ?? []
  const configuredRef = props.description?.ref ?? candidates.find(candidate => candidate.configured)?.ref ?? props.refs[0]
  const writable = props.description?.writable !== false

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
        {(candidates.length === 0
          ? props.refs.map((ref): CredentialCandidate => ({ ref, configured: false }))
          : candidates
        ).map(candidate => (
          <span key={candidate.ref} style={ROW}>
            <code style={{ fontSize: '11px' }}>{candidate.ref}</code>
            {candidate.configured ? (
              <Tag tone="success">{t('credentialConfigured', { source: candidate.source ?? '' })}</Tag>
            ) : (
              <Tag tone="neutral">{t('credentialMissing')}</Tag>
            )}
          </span>
        ))}
        {writable ? null : <span style={MUTED}>{t('credentialLocked')}</span>}
      </div>
      <div style={ROW}>
        <Input
          type="password"
          autoComplete="off"
          value={draft}
          disabled={!writable || props.credentials === undefined}
          placeholder={t('credentialPlaceholder')}
          onChange={event => setDraft((event.target as HTMLInputElement).value)}
          style={{ maxWidth: '280px' }}
        />
        <Button size="sm" variant="primary" disabled={draft.trim() === ''} onClick={() => void save()}>
          {t('credentialSave')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={configuredRef === undefined || props.description?.configured !== true}
          onClick={() => void clear()}
        >
          {t('credentialClear')}
        </Button>
      </div>
      <span style={MUTED}>{note ?? t('credentialHint')}</span>
    </div>
  )
}

/** What this row currently resolves to, in one short phrase. */
function resolutionLabel(row: ProviderRow, catalog: SourceCatalog, t: Translate): string {
  const { resolution } = row
  if (resolution.reason === 'hidden') return t('modeHidden')
  if (resolution.reason === 'needs-endpoint') return t('needsEndpoint')
  if (resolution.reason === 'unknown-source') return t('unknownSource')
  if (resolution.reason === 'unsupported' || resolution.mode === null || resolution.sourceId === null) {
    return t('modeUnsupported')
  }
  const sourceLabel = catalog.find(entry => entry.id === resolution.sourceId)?.displayName ?? resolution.sourceId
  const target = `${sourceLabel} · ${windowModeLabel(resolution.mode, t)}`
  return resolution.reason === 'auto' ? t('detectedAs', { target }) : t('showsAs', { target })
}

function ProviderCard(props: {
  t: Translate
  row: ProviderRow
  config: UsageStateConfig
  catalog: SourceCatalog
  credentials: CredentialsRemoteLike | undefined
  description: CredentialDescription | undefined
  /** Failure of the last reading for this account, if any. */
  failure: { kind: string; detail?: string } | undefined
  index: number
  total: number
  onMode: (mode: ProviderMode) => void
  onMove: (delta: number) => void
  onField: (path: string[], value: string) => void
  onClearField: (path: string[]) => void
  onCredentialChanged: () => void
}) {
  const { t, row } = props
  const entry = props.config.providers[row.provider]
  const resolvedSource =
    row.resolution.sourceId === null ? undefined : props.catalog.find(candidate => candidate.id === row.resolution.sourceId)
  // Even before a mode is pinned down (a self-hosted source still needs its
  // endpoint), the user has to know which credential name will be looked for, so
  // fall back to the source's first mode rather than showing nothing.
  const refMode = row.resolution.mode ?? resolvedSource?.modes[0]
  const refs: string[] = refMode === undefined ? [] : [...(resolvedSource?.credentialRefs[refMode] ?? [])]

  const modelNames = row.models.map(model => model.name)
  const listed = modelNames.slice(0, MAX_MODELS_SHOWN).join(' · ')
  const suffix = modelNames.length > MAX_MODELS_SHOWN ? ', …' : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingBottom: '6px' }}>
      <div style={{ ...ROW, justifyContent: 'space-between' }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <strong>{row.providerName}</strong>
          {row.providerName === row.provider ? null : <span style={MUTED}> {row.provider}</span>}
        </span>
        <span style={ROW}>
          <Button size="sm" variant="ghost" aria-label={t('moveUp')} disabled={props.index === 0} onClick={() => props.onMove(-1)}>
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('moveDown')}
            disabled={props.index === props.total - 1}
            onClick={() => props.onMove(1)}
          >
            ↓
          </Button>
          {row.modes.map(mode => (
            <Button
              key={mode}
              size="sm"
              variant={row.selected === mode ? 'primary' : 'outline'}
              onClick={() => props.onMode(mode)}
            >
              {modeLabel(mode, t)}
            </Button>
          ))}
        </span>
      </div>

      <span style={MUTED}>{resolutionLabel(row, props.catalog, t)}</span>
      {props.failure === undefined ? null : (
        <span style={MUTED}>
          ⚠ {t(`error.${props.failure.kind}`)}
          {props.failure.detail === undefined ? '' : ` — ${props.failure.detail}`}
        </span>
      )}
      <span style={MUTED}>
        {modelNames.length === 0 ? t('noModels') : t('modelsPrefix', { list: `${listed}${suffix}` })}
      </span>

      <details>
        <summary style={{ ...MUTED, cursor: 'pointer' }}>{t('advanced')}</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px' }}>
          <div style={ROW}>
            <span style={MUTED}>{t('sourceLabel')}</span>
            <select
              value={entry?.sourceId ?? ''}
              onChange={event => {
                const value = (event.target as HTMLSelectElement).value
                if (value === '') props.onClearField(['providers', row.provider, 'sourceId'])
                else props.onField(['providers', row.provider, 'sourceId'], value)
              }}
            >
              <option value="">{t('sourceAuto')}</option>
              {props.catalog.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.displayName}
                </option>
              ))}
            </select>
          </div>

          <div style={ROW}>
            <span style={MUTED}>{t('baseUrl')}</span>
            <DraftInput
              value={entry?.baseUrl ?? ''}
              placeholder={
                row.resolution.mode === null
                  ? t('baseUrlPlaceholder')
                  : (resolvedSource?.defaultBaseUrl[row.resolution.mode] ?? t('baseUrlPlaceholder'))
              }
              width="320px"
              onCommit={value => {
                if (value === '') props.onClearField(['providers', row.provider, 'baseUrl'])
                else props.onField(['providers', row.provider, 'baseUrl'], value)
              }}
            />
            {resolvedSource?.requiresBaseUrl === true && entry?.baseUrl === undefined ? (
              <Tag tone="warning">{t('baseUrlRequired')}</Tag>
            ) : null}
          </div>

          <div style={ROW}>
            <span style={MUTED}>{t('apiKeyRef')}</span>
            <DraftInput
              value={entry?.apiKeyRef ?? ''}
              width="220px"
              onCommit={value => {
                if (value === '') props.onClearField(['providers', row.provider, 'apiKeyRef'])
                else props.onField(['providers', row.provider, 'apiKeyRef'], value)
              }}
            />
            <span style={MUTED}>{t('apiKeyRefHint')}</span>
          </div>

          <CredentialPanel
            t={t}
            refs={refs}
            description={props.description}
            credentials={props.credentials}
            onChanged={props.onCredentialChanged}
          />
        </div>
      </details>
    </div>
  )
}

/**
 * The plugin's settings page: one row per provider. The reading is account-level,
 * so per-model configuration was both long and redundant. Everything the plugin
 * can work out on its own — which source, which mode, which key — is left to
 * "auto"; only deviations are written to the settings document.
 */
export function SettingsSection(props: SettingsSectionProps) {
  const { t } = props
  const snapshot = useSettingsValue(props.settings)
  const state = useStoreState(props.usageState)

  useEffect(() => {
    void props.usageState.refreshModels()
    void props.usageState.refreshCredentials()
  }, [props.usageState])

  if (snapshot.status === 'unavailable') {
    return <p style={MUTED}>{t('unavailable')}</p>
  }

  const config = normalizeConfig(snapshot.value ?? {})
  const rows = buildProviderRows({ models: state.models, config, catalog: state.catalog })

  const write = (path: string[], value: unknown) => {
    void props.settings.mutate([{ op: 'set', path, value }])
  }
  const clear = (path: string[]) => {
    void props.settings.mutate([{ op: 'unset', path }])
  }

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
        <strong>{t('sectionProviders')}</strong>
        <span style={MUTED}>{t('sectionProvidersHint')}</span>
        {rows.length === 0 ? <span style={MUTED}>{t('empty')}</span> : null}
        {rows.map((row, index) => (
          <ProviderCard
            key={row.provider}
            t={t}
            row={row}
            config={config}
            catalog={state.catalog}
            credentials={props.credentials}
            description={row.resolution.key === undefined ? undefined : state.credentials[row.resolution.key]}
            failure={row.resolution.key === undefined ? undefined : state.snapshots[row.resolution.key]?.error}
            index={index}
            total={rows.length}
            onMode={mode => write(['providers'], setProviderMode(config.providers, row.provider, mode))}
            onMove={delta => {
              const next = reorderProviders(config.order, row.provider, delta)
              if (next !== undefined) write(['order'], next)
            }}
            onField={(path, value) => write(path, value)}
            onClearField={path => clear(path)}
            onCredentialChanged={() => void props.usageState.refreshCredentials()}
          />
        ))}
      </section>

      <section style={CARD}>
        <strong>{t('sectionDisplay')}</strong>
        <div style={ROW}>
          <span style={MUTED}>{t('thresholdWarn')}</span>
          <DraftInput
            type="number"
            value={String(config.display.thresholdWarnPercent)}
            width="90px"
            onCommit={value => write(['display', 'thresholdWarnPercent'], Number(value))}
          />
          <span style={MUTED}>{t('thresholdCritical')}</span>
          <DraftInput
            type="number"
            value={String(config.display.thresholdCriticalPercent)}
            width="90px"
            onCommit={value => write(['display', 'thresholdCriticalPercent'], Number(value))}
          />
        </div>
        <div style={ROW}>
          <span style={MUTED}>{t('intervalMinutes')}</span>
          <DraftInput
            type="number"
            value={String(config.refresh.intervalMinutes)}
            width="90px"
            onCommit={value => write(['refresh', 'intervalMinutes'], Number(value))}
          />
        </div>
        <Switch
          checked={config.display.progressBar}
          label={t('progressBar')}
          onChange={next => write(['display', 'progressBar'], next)}
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
