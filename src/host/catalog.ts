import { ALL_SOURCES } from './sources/index.ts'
import type { UsageSource } from './sources/types.ts'
import type { UsageMode } from '../shared/types.ts'
import type { SourceCatalog, SourceCatalogEntry } from '../shared/display.ts'

/** Flatten the adapters into plain JSON, because this crosses the RPC boundary. */
export function toSourceCatalog(sources: readonly UsageSource[] = ALL_SOURCES): SourceCatalog {
  return sources.map(source => {
    const defaultBaseUrl: Partial<Record<UsageMode, string>> = {}
    const credentialRefs: Partial<Record<UsageMode, string[]>> = {}

    for (const mode of source.modes) {
      const base = source.defaultBaseUrl(mode)
      if (base !== undefined) defaultBaseUrl[mode] = base
      credentialRefs[mode] = [...source.credentialRefs(mode)]
    }

    const entry: SourceCatalogEntry = {
      id: source.id,
      displayName: source.displayName,
      modes: [...source.modes],
      requiresBaseUrl: source.requiresBaseUrl === true,
      defaultBaseUrl,
      credentialRefs,
    }
    return entry
  })
}
