import { deepseek } from './deepseek.ts'
import { kimi } from './kimi.ts'
import { opencode } from './opencode.ts'
import { sub2api } from './sub2api.ts'
import type { UsageSource } from './types.ts'
import { zai } from './zai.ts'

/** Every data source shipped in v1, in the order the settings page lists them. */
export const ALL_SOURCES: readonly UsageSource[] = [deepseek, zai, kimi, opencode, sub2api]

export function findSource(id: string): UsageSource | undefined {
  return ALL_SOURCES.find(source => source.id === id)
}

export { deepseek, kimi, opencode, sub2api, zai }
export type { UsageSource }
export { SourceError } from './types.ts'
export type { RequestInput, SourceFailureKind, UsageRequest } from './types.ts'
