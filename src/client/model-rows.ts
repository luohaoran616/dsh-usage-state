import { suggestSourceId, type ModelConfigEntry, type ModelMode, type UsageStateConfig } from '../shared/config.ts'
import type { SourceCatalog } from '../shared/display.ts'

/** One model as the DSH catalog reports it. */
export interface CatalogModelRow {
  provider: string
  providerName: string
  model: string
  name: string
}

/** One row of the settings page's model list. */
export interface ModelRow extends CatalogModelRow {
  key: string
  sourceId: string | null
  mode: ModelMode
  /** True when the catalog knows the model but nothing has been configured for it yet. */
  unconfigured: boolean
  /** Selectable modes: what the chosen source serves, plus `hidden`. */
  modes: ModelMode[]
}

/** Stable identity of one model, safe against id strings containing separators. */
export function rowKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

const ALL_MODES: ModelMode[] = ['api', 'coding-plan', 'hidden']

function modesOf(catalog: SourceCatalog, sourceId: string | null): ModelMode[] {
  if (sourceId === null) return [...ALL_MODES]
  const source = catalog.find(entry => entry.id === sourceId)
  if (source === undefined) return [...ALL_MODES]
  return [...source.modes, 'hidden']
}

/**
 * Merge the DSH catalog with the user's configuration.
 *
 * Configured models come first in their configured order — that order *is* the
 * display order — followed by everything the catalog knows but that has not been
 * configured yet. A configured model that disappeared from the catalog still
 * appears, otherwise the user could never fix or remove it.
 */
export function buildModelRows(input: {
  models: readonly CatalogModelRow[]
  config: UsageStateConfig
  catalog: SourceCatalog
}): ModelRow[] {
  const { models, config, catalog } = input
  const catalogByKey = new Map(models.map(model => [rowKey(model.provider, model.model), model]))
  const rows: ModelRow[] = []
  const seen = new Set<string>()

  for (const entry of config.models) {
    const key = rowKey(entry.provider, entry.model)
    if (seen.has(key)) continue
    seen.add(key)
    const known = catalogByKey.get(key)
    rows.push({
      key,
      provider: entry.provider,
      providerName: known?.providerName ?? entry.provider,
      model: entry.model,
      name: known?.name ?? entry.model,
      sourceId: entry.sourceId,
      mode: entry.mode,
      unconfigured: false,
      modes: modesOf(catalog, entry.sourceId),
    })
  }

  for (const model of models) {
    const key = rowKey(model.provider, model.model)
    if (seen.has(key)) continue
    seen.add(key)
    const sourceId = suggestSourceId(model.provider) ?? null
    rows.push({
      ...model,
      key,
      sourceId,
      mode: 'hidden',
      unconfigured: true,
      modes: modesOf(catalog, sourceId),
    })
  }

  return rows
}

/** Set (or add) one model's configuration, preserving the existing order. */
export function configureModel(
  models: readonly ModelConfigEntry[],
  input: { provider: string; model: string; sourceId: string | null; mode: ModelMode },
): ModelConfigEntry[] {
  const entry: ModelConfigEntry = {
    provider: input.provider,
    model: input.model,
    sourceId: input.sourceId,
    mode: input.mode,
  }
  const index = models.findIndex(candidate => candidate.provider === input.provider && candidate.model === input.model)
  if (index < 0) return [...models, entry]

  const next = [...models]
  next[index] = entry
  return next
}

/**
 * Move one configured model by `delta` positions. Returns `undefined` when the
 * move is impossible (unknown model, or already at the end), so callers can skip
 * a pointless write.
 */
export function reorderModels(
  models: readonly ModelConfigEntry[],
  key: string,
  delta: number,
): ModelConfigEntry[] | undefined {
  const index = models.findIndex(entry => rowKey(entry.provider, entry.model) === key)
  if (index < 0) return undefined

  const target = index + delta
  if (target < 0 || target >= models.length) return undefined

  const next = [...models]
  const moved = next[index]
  const displaced = next[target]
  if (moved === undefined || displaced === undefined) return undefined
  next[index] = displaced
  next[target] = moved
  return next
}
