import { suggestSourceId, type ProviderConfigEntry, type ProviderMode, type UsageStateConfig } from '../shared/config.ts'
import type { SourceCatalog } from '../shared/display.ts'
import { orderProviders, resolveProvider, type ProviderResolution } from '../shared/providers.ts'
import type { CatalogModelRow, ProviderRegistry } from './model-rows.ts'

/**
 * One settings-page row: a DSH provider, the models behind it, and the account it
 * resolves to. Models are grouped because the reading is account-level — asking
 * the same question once per model was both long and redundant.
 */
export interface ProviderRow {
  provider: string
  providerName: string
  models: ReadonlyArray<{ id: string; name: string }>
  resolution: ProviderResolution
  /** Mode stored for this provider; an absent entry means `auto`. */
  selected: ProviderMode
  /** Modes this row offers: `auto`, whatever the relevant source serves, and `hidden`. */
  modes: ProviderMode[]
}

export interface BuildProviderRowsInput {
  models: readonly CatalogModelRow[]
  config: UsageStateConfig
  catalog: SourceCatalog
  endpointHints?: Readonly<Record<string, string>>
  /**
   * The live DSH provider registry.
   *
   * `undefined` means "not known yet" (the catalog has not loaded, or the host does
   * not report one), and then every stored entry keeps its row — a slow or failed
   * catalog lookup must never hide configuration the user needs to inspect or clear.
   * Once known, the registry decides: a stored entry survives only for a provider DSH
   * still has whose models could not be listed. A provider that was deleted, or that
   * now lists no models at all, gets no row.
   */
  registry?: ProviderRegistry
}

/**
 * Whether a stored entry that the model catalog does not list still deserves a row.
 * A provider DSH has but whose model list failed is real, just unreadable, so its row
 * stays; one that is routable with zero models looks deleted in DSH's own model list,
 * so its row goes with it.
 */
function stillConfigured(registry: ProviderRegistry, provider: string): boolean {
  return registry.routable.includes(provider) && registry.failed.includes(provider)
}

export function buildProviderRows(input: BuildProviderRowsInput): ProviderRow[] {
  const grouped = new Map<string, { providerName: string; models: Array<{ id: string; name: string }> }>()
  for (const model of input.models) {
    const existing = grouped.get(model.provider)
    if (existing === undefined) {
      grouped.set(model.provider, { providerName: model.providerName, models: [{ id: model.model, name: model.name }] })
    } else {
      existing.models.push({ id: model.model, name: model.name })
    }
  }

  // A provider that is configured but no longer offered by DSH is stale. Its entry is
  // left in the document (re-adding the provider restores the chosen mode), but it must
  // not leave a phantom row on the page for a provider that is gone.
  for (const provider of [...input.config.order, ...Object.keys(input.config.providers)]) {
    if (grouped.has(provider)) continue
    if (input.registry !== undefined && !stillConfigured(input.registry, provider)) continue
    grouped.set(provider, { providerName: provider, models: [] })
  }

  return orderProviders([...grouped.keys()], input.config).map(provider => {
    const group = grouped.get(provider)
    const entry = input.config.providers[provider]
    const endpointHint = input.endpointHints?.[provider]

    const sourceId = entry?.sourceId ?? suggestSourceId(provider, endpointHint) ?? null
    const source = sourceId === null ? undefined : input.catalog.find(candidate => candidate.id === sourceId)
    const modes: ProviderMode[] = ['auto', ...(source?.modes ?? (['api', 'coding-plan'] as const)), 'hidden']

    return {
      provider,
      providerName: group?.providerName ?? provider,
      models: group?.models ?? [],
      resolution: resolveProvider({
        provider,
        config: input.config,
        catalog: input.catalog,
        ...(endpointHint === undefined ? {} : { endpointHint }),
      }),
      selected: entry?.mode ?? 'auto',
      modes: [...new Set(modes)],
    }
  })
}

/** Set one provider's mode, preserving its other overrides and every other provider. */
export function setProviderMode(
  providers: Readonly<Record<string, ProviderConfigEntry>>,
  provider: string,
  mode: ProviderMode,
): Record<string, ProviderConfigEntry> {
  const existing = providers[provider]
  return { ...providers, [provider]: { ...(existing ?? {}), mode } }
}

/** Swap a provider with its neighbour; `undefined` when the move is impossible. */
export function reorderProviders(
  order: readonly string[],
  provider: string,
  delta: number,
): string[] | undefined {
  const index = order.indexOf(provider)
  if (index < 0) return undefined
  const target = index + delta
  if (target < 0 || target >= order.length) return undefined

  const next = [...order]
  const moved = next[index]
  const displaced = next[target]
  if (moved === undefined || displaced === undefined) return undefined
  next[index] = displaced
  next[target] = moved
  return next
}
