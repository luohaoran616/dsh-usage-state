import type { UsageStateConfig } from '../shared/config.ts'
import type { CredentialReport, RemoteResult, UsageStateView } from '../shared/rpc.ts'

/**
 * Structural mirrors of the platform services this plugin's browser half uses.
 *
 * The client bundle runs inside the shell's module table, so it must not import
 * platform packages at runtime — and typing them structurally also avoids
 * interface-merge collisions between host and client package typings. The shapes
 * below come from the installed 0.1.5-rc.2 declarations.
 */

export interface Translate {
  (key: string, params?: Record<string, unknown>): string
}

export interface LocaleRuntimeLike {
  /** Typed form: both built-in locales in one call. */
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  bind(namespace: string): Translate
  getSnapshot(): { active: string; revision: number }
  subscribe(listener: () => void): () => void
}

export interface SlotRegistryLike {
  inject(key: string, callback: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** The read-only slice of a settings scope: enough for any component to render from. */
export interface SettingsSource<S> {
  getSnapshot(): S
  subscribe(listener: () => void): () => void
}

export interface SettingsScopeSnapshotLike<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
}

export interface SettingsScopeLike<T> extends SettingsSource<SettingsScopeSnapshotLike<T>> {
  getSnapshot(): SettingsScopeSnapshotLike<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
  mutate(ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
}

export interface SettingsPathOp {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

export interface SettingsScopeBinderLike {
  bind<T>(spec: { namespace: string; decode?: (section: unknown) => T | undefined }): SettingsScopeLike<T>
}

export interface RemoteServiceLike {
  getState(force: boolean): Promise<RemoteResult<UsageStateView>>
  describeCredentials(): Promise<RemoteResult<CredentialReport>>
}

export interface CredentialsRemoteLike {
  describe(refs: string[]): Promise<RemoteResult<Record<string, { configured: boolean; source?: string; writable: boolean }>>>
  set(ref: string, value: string): Promise<RemoteResult<void>>
  unset(ref: string): Promise<RemoteResult<void>>
}

export interface RemoteLike {
  $mount(contribution: unknown): Promise<() => void>
  usageState?: RemoteServiceLike
  credentials?: CredentialsRemoteLike
  session?: { modelCatalog(): Promise<RemoteResult<ModelCatalogLike>> }
}

export interface ModelCatalogLike {
  groups: ReadonlyArray<{ id: string; name: string; models: ReadonlyArray<{ id: string; name: string }> }>
  /** Provider ids DSH currently has. Absent on hosts that predate this field. */
  routableProviders?: readonly string[]
  /** Providers DSH has whose model list could not be loaded. */
  failures?: ReadonlyArray<{ id: string; name: string; message: string }>
}

export interface ClientContextLike {
  inject(names: readonly string[], callback: (ctx: ClientContextLike) => void): void
  effect(callback: () => (() => void) | void, label?: string): void
  on(event: string, handler: (...args: unknown[]) => void): () => void
  get(name: string): unknown
  locale: LocaleRuntimeLike
  slots: SlotRegistryLike
  settingsScope: SettingsScopeBinderLike
  remote: RemoteLike
  /** Present on a session-scoped slot; `modelSelection` lives here. */
  useProjection?<T>(key: string): T | undefined
}

/** The client projection that says which model a session will use next. */
export interface ModelSelectionProjectionLike {
  lastUsed: { provider: string; model: string } | null
  next: { provider: string; model: string } | null
}

export type UsageStateSettings = UsageStateConfig
