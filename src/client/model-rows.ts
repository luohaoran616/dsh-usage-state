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
