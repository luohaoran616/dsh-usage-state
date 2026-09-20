import type { UsageStateConfig } from '../shared/config.ts'
import type { UsageMode } from '../shared/types.ts'
import { ALL_SOURCES, findSource } from './sources/index.ts'
import type { UsageSource } from './sources/types.ts'

/** One pollable reading: an account-level source used in one mode. */
export interface UsageTarget {
  /** Stable key, also used by the browser to look a snapshot up. */
  key: string
  sourceId: string
  mode: UsageMode
}

export function targetKey(sourceId: string, mode: UsageMode): string {
  return `${sourceId}:${mode}`
}

/**
 * The set of readings the plugin should keep fresh, in display order.
 *
 * Balance and quota are account-level, so several models sharing one source and
 * mode collapse into a single target — the status line never shows the same
 * account twice. Models that are hidden, unconfigured, point at an unknown source,
 * or ask for a mode the source cannot serve are skipped silently.
 */
export function resolveTargets(
  config: UsageStateConfig,
  sources: readonly UsageSource[] = ALL_SOURCES,
): UsageTarget[] {
  const targets: UsageTarget[] = []
  const seen = new Set<string>()

  for (const entry of config.models) {
    if (entry.mode === 'hidden' || entry.sourceId === null) continue

    const source = sources.find(candidate => candidate.id === entry.sourceId)
    if (source === undefined || !source.modes.includes(entry.mode)) continue

    const key = targetKey(source.id, entry.mode)
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ key, sourceId: source.id, mode: entry.mode })
  }

  return targets
}

export { findSource }
