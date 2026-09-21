/**
 * One model as the DSH catalog reports it. Models are no longer a configuration
 * unit (readings are account-level), so this is all that remains of the former
 * per-model rows: providers group these for display.
 */
export interface CatalogModelRow {
  provider: string
  providerName: string
  model: string
  name: string
}

/**
 * Which providers DSH currently has, and which of them could not list their models.
 *
 * The catalog's `groups` cannot answer "does this provider still exist": DSH filters
 * providers with zero models out of it, so a provider whose models were all deleted
 * looks identical to one that was removed. `routableProviders` is the registry itself,
 * which is what lets the settings page drop a row for a provider that is really gone.
 */
export interface ProviderRegistry {
  /** Every provider id DSH currently has. */
  routable: readonly string[]
  /** Providers DSH has whose model list failed to load (still real, just unreadable). */
  failed: readonly string[]
}
