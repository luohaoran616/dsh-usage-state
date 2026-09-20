import { suggestSourceId } from '../shared/config.ts'

/**
 * Inputs for deriving credential refs from the DSH provider configuration.
 * Both namespaces are read as `unknown` because they belong to other plugins.
 */
export interface ProviderCredentialRefsInput {
  sourceId: string
  /** The `llm-deepseek` settings namespace, when the host has it. */
  deepseekSettings?: unknown
  /** The `llm-pi-ai` settings namespace, when the host has it. */
  piAiSettings?: unknown
  /** Source-suggestion override, for tests. */
  suggest?: (providerId: string, baseUrl?: string) => string | undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * The `apiKeyEnv` values the user already declared for the providers that feed a
 * data source. These are probed before the source's built-in ref names, so a
 * provider configured with a custom environment variable works without any
 * extra configuration in this plugin.
 */
export function providerCredentialRefs(input: ProviderCredentialRefsInput): string[] {
  const suggest = input.suggest ?? suggestSourceId
  const refs: string[] = []
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return
    const ref = value.trim()
    if (ref === '' || refs.includes(ref)) return
    refs.push(ref)
  }

  if (input.sourceId === 'deepseek') {
    push(asRecord(input.deepseekSettings)?.apiKeyEnv)
  }

  const providers = asRecord(asRecord(input.piAiSettings)?.providers)
  if (providers === undefined) return refs

  for (const [providerId, raw] of Object.entries(providers)) {
    const profile = asRecord(raw)
    if (profile === undefined) continue
    const baseUrl = typeof profile.baseURL === 'string' ? profile.baseURL : undefined
    if (suggest(providerId, baseUrl) !== input.sourceId) continue
    push(profile.apiKeyEnv)
  }

  return refs
}
