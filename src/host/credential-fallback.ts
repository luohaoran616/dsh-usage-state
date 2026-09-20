import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { CredentialLookup } from './credentials.ts'

/**
 * Last-resort credential sources, used only when the platform's credential
 * service cannot answer.
 *
 * The platform provider resolves `inherited environment > $DSH_HOME/.credentials.yaml`
 * (see `dsh-credentials-local`), so these fallbacks follow the same precedence and
 * never override it. They exist because a plugin row mounted at the profile root
 * may not see the credentials service at all, and a balance line that silently
 * shows "not configured" is worse than reading the same two sources directly.
 *
 * `source` values are suffixed `(direct)` so the settings page tells the truth
 * about where a key came from — if this ever fires in practice, that is visible
 * rather than silent.
 */
export interface FallbackDeps {
  /** Defaults to the process environment. */
  environment?: Record<string, string | undefined>
  /** Defaults to `$DSH_HOME/.credentials.yaml` (or `~/.dsh/.credentials.yaml`). */
  credentialsPath?: string
}

/** Extract one ref from the `refs:` block of a credentials document. */
export function refFromCredentialsDocument(text: string, ref: string): string | undefined {
  const lines = text.split(/\r?\n/)
  let inRefs = false
  for (const line of lines) {
    if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(line)) {
      inRefs = line.startsWith('refs:')
      continue
    }
    if (!inRefs) continue

    const match = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (match === null || match[1] !== ref) continue

    const raw = (match[2] ?? '').trim()
    if (raw === '' || raw === 'null' || raw === '~') return undefined
    const unquoted = /^(['"])(.*)\1$/.exec(raw)
    return unquoted === null ? raw : (unquoted[2] ?? '')
  }
  return undefined
}

function defaultCredentialsPath(): string {
  const home = process.env.DSH_HOME
  const root = home !== undefined && home.trim() !== '' ? home : join(homedir(), '.dsh')
  return join(root, '.credentials.yaml')
}

/**
 * Wrap the platform lookup with the direct fallbacks. The platform answer always
 * wins; the fallbacks only run when it reports "not configured".
 */
export function withCredentialFallback(platform: CredentialLookup, deps: FallbackDeps = {}): CredentialLookup {
  const environment = deps.environment ?? process.env
  const path = deps.credentialsPath ?? defaultCredentialsPath()

  const fromEnvironment = (ref: string): { value: string; source: string } | undefined => {
    const value = environment[ref]
    return typeof value === 'string' && value.trim() !== '' ? { value, source: 'env (direct)' } : undefined
  }

  const fromFile = (ref: string): { value: string; source: string } | undefined => {
    try {
      const value = refFromCredentialsDocument(readFileSync(path, 'utf8'), ref)
      return value === undefined ? undefined : { value, source: 'file (direct)' }
    } catch {
      return undefined
    }
  }

  return {
    resolve: async ref => {
      const platformValue = await platform.resolve(ref)
      if (platformValue !== undefined) return platformValue
      return fromEnvironment(ref) ?? fromFile(ref)
    },
    describe: async ref => {
      const described = await platform.describe(ref)
      if (described.configured) return described
      const fallback = fromEnvironment(ref) ?? fromFile(ref)
      if (fallback === undefined) return described
      return { configured: true, source: fallback.source, writable: false }
    },
  }
}
