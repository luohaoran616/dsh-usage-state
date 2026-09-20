import { normalizeConfig, type UsageStateConfig } from '../shared/config.ts'

/** Settings namespace owned by this plugin; must match `/^[a-z][a-z0-9-]*$/`. */
export const USAGE_STATE_NS = 'usage-state'

/**
 * The settings service only requires a callable that returns the resolved section
 * plus a `toJSON()`, so this stays free of any import — the platform's own schema
 * package (`@deepseek-ai/schemastery`) is not resolvable from a plugin directory
 * mounted with `link:`, and a throwing schema would block plugin load when the
 * hand-editable settings document is dirty.
 *
 * `toJSON()` advertises no fields on purpose: this plugin ships its own settings
 * page and reads the value through its own decoder, so no schema-driven form is
 * ever rendered from it.
 */
export interface SettingsSchemaLike {
  (section: unknown): UsageStateConfig
  toJSON(): unknown
}

export const usageStateSchema: SettingsSchemaLike = Object.assign(
  (section: unknown): UsageStateConfig => normalizeConfig(section),
  { toJSON: (): unknown => ({ uid: 1, refs: { 1: { type: 'object', meta: {}, dict: {} } } }) },
)

/** The slice of a settings scope this plugin uses. */
export interface SettingsScopeLike {
  get(): unknown
  watch(callback: (next: unknown, prev: unknown) => void): () => void
}

export interface SettingsServiceLike {
  register(
    namespace: string,
    schema: SettingsSchemaLike,
    options?: { applies?: 'live' | 'restart' },
  ): SettingsScopeLike
}

/**
 * The two cordis context members used here, typed structurally so the host half
 * needs no platform packages at runtime or compile time.
 */
export interface HostContextLike {
  inject(names: readonly string[], callback: (ctx: { settings: SettingsServiceLike }) => void): void
}

/**
 * Register the namespace and keep a live in-process snapshot of it.
 *
 * `ctx.inject` is the graceful-degradation boundary: on a host without a settings
 * provider the callback never runs and the plugin's own defaults stand. `applies`
 * is metadata in this DSH version — what actually makes a change live is the
 * `watch` subscription below.
 */
export function installUsageStateSettings(ctx: HostContextLike, onConfig: (config: UsageStateConfig) => void): void {
  ctx.inject(['settings'], settingsCtx => {
    const scope = settingsCtx.settings.register(USAGE_STATE_NS, usageStateSchema, { applies: 'live' })
    onConfig(normalizeConfig(scope.get()))
    scope.watch(next => onConfig(normalizeConfig(next)))
  })
}
