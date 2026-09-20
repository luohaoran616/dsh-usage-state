import type { UsageMode } from '../shared/types.ts'
import type { UsageSource } from './sources/types.ts'

/** What the DSH credential provider tells us about one ref. */
export interface CredentialLookup {
  /** Resolve a ref to its value and the layer it came from (env / store / file). */
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
  /** Report whether a ref is configured, without reading its value. */
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>
}

export interface CredentialOptions {
  /** Explicit ref chosen in the plugin's settings; wins over every built-in candidate. */
  overrideRef?: string
  /** Refs discovered from the provider's own configuration, e.g. its `apiKeyEnv`. */
  preferredRefs?: readonly string[]
}

export interface ResolvedApiKey {
  apiKey: string
  ref: string
  /** Where the value came from, as reported by the credential provider. */
  origin: string
}

import type { CredentialCandidate, CredentialDescription } from '../shared/rpc.ts'

export type { CredentialCandidate, CredentialDescription }

function clean(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined
  const trimmed = ref.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * The refs to probe for one source+mode, most specific first: the user's explicit
 * override, then refs derived from the provider's own configuration, then the
 * source's built-in candidates.
 */
export function orderedCredentialRefs(
  source: UsageSource,
  mode: UsageMode,
  options: CredentialOptions = {},
): string[] {
  const ordered: string[] = []
  for (const candidate of [clean(options.overrideRef), ...(options.preferredRefs ?? []), ...source.credentialRefs(mode)]) {
    const ref = clean(candidate)
    if (ref === undefined || ordered.includes(ref)) continue
    ordered.push(ref)
  }
  return ordered
}

/** The first candidate that resolves to a non-blank secret wins. */
export async function resolveApiKey(
  source: UsageSource,
  mode: UsageMode,
  options: CredentialOptions,
  lookup: CredentialLookup,
): Promise<ResolvedApiKey | undefined> {
  for (const ref of orderedCredentialRefs(source, mode, options)) {
    const resolved = await lookup.resolve(ref)
    if (resolved === undefined || resolved.value.trim() === '') continue
    return { apiKey: resolved.value, ref, origin: resolved.source }
  }
  return undefined
}

/**
 * Status of every candidate, for the settings page. Never returns a secret: only
 * whether a ref is configured and which layer provides it.
 */
export async function describeCredentials(
  source: UsageSource,
  mode: UsageMode,
  options: CredentialOptions,
  lookup: CredentialLookup,
): Promise<CredentialDescription> {
  const candidates: CredentialCandidate[] = []
  let resolvedRef: string | undefined
  let resolvedSource: string | undefined
  let resolvedWritable: boolean | undefined

  for (const ref of orderedCredentialRefs(source, mode, options)) {
    const described = await lookup.describe(ref)
    const candidate: CredentialCandidate = { ref, configured: described.configured, writable: described.writable }
    if (described.source !== undefined) candidate.source = described.source
    candidates.push(candidate)

    if (described.configured && resolvedRef === undefined) {
      resolvedRef = ref
      resolvedSource = described.source
      resolvedWritable = described.writable
    }
  }

  return {
    candidates,
    configured: resolvedRef !== undefined,
    ref: resolvedRef,
    source: resolvedSource,
    writable: resolvedWritable,
  }
}
