import type { UsageMode, UsageReading } from '../shared/types.ts'
import type { ResolvedTargetCredential } from './refresh.ts'
import type { SourceFailureKind, UsageSource } from './sources/types.ts'
import { SourceError } from './sources/types.ts'
import type { UsageTarget } from './targets.ts'

/** The part of `fetch` we depend on, so tests never touch the network. */
export interface HttpResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface FetchLike {
  (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }): Promise<HttpResponseLike>
}

export interface ReaderDeps {
  fetch: FetchLike
  /** Hard timeout for one provider call. `0` disables the signal entirely. */
  timeoutMs?: number
}

export interface ReadInput {
  source: UsageSource
  mode: UsageMode
  apiKey: string
  baseUrl?: string
  /** True when the endpoint is the user's explicit choice, so no mirror is tried. */
  pinnedBaseUrl?: boolean
}

/** A hung billing endpoint must not wedge the plugin's refresh loop. */
export const DEFAULT_TIMEOUT_MS = 15_000

/**
 * A rejected key and a broken endpoint need different copy in the UI, so HTTP
 * statuses are classified rather than collapsed into one "failed" bucket.
 */
export function failureKindForStatus(status: number): SourceFailureKind {
  if (status === 401 || status === 403) return 'auth'
  return 'http'
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * The whole network path for one reading: ask the adapter for a request, send it,
 * decode JSON, hand the payload back to the adapter's pure parser, and translate
 * every failure into a `SourceError` the UI knows how to phrase.
 */
export async function readUsage(input: ReadInput, deps: ReaderDeps): Promise<UsageReading> {
  const requestInput = {
    mode: input.mode,
    apiKey: input.apiKey,
    ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
    ...(input.pinnedBaseUrl === true ? { pinnedBaseUrl: true } : {}),
  }
  const candidates = [input.source.request(requestInput), ...(input.source.fallbackRequests?.(requestInput) ?? [])]

  const failures: SourceError[] = []
  for (const [index, request] of candidates.entries()) {
    try {
      const payload = await fetchPayload(request, deps)
      return input.source.parse(payload, input.mode)
    } catch (error) {
      const failure = toSourceError(error)
      failures.push(failure)
      if (index === candidates.length - 1) break
    }
  }

  // Report the most actionable failure: an endpoint that answered (auth/parse/http)
  // says more than one that was simply unreachable.
  throw failures.find(failure => failure.kind !== 'network') ?? failures[0] ?? new SourceError('network', 'no endpoint tried')
}

function toSourceError(error: unknown): SourceError {
  return error instanceof SourceError ? error : new SourceError('network', messageOf(error))
}

async function fetchPayload(request: { url: string; headers: Record<string, string> }, deps: ReaderDeps): Promise<unknown> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined

  let response: HttpResponseLike
  try {
    response = await deps.fetch(
      request.url,
      signal === undefined ? { headers: request.headers } : { headers: request.headers, signal },
    )
  } catch (error) {
    throw new SourceError('network', messageOf(error))
  }

  if (!response.ok) {
    throw new SourceError(failureKindForStatus(response.status), `HTTP ${response.status}`)
  }

  try {
    return await response.json()
  } catch (error) {
    throw new SourceError('parse', `invalid JSON: ${messageOf(error)}`)
  }
}

/** Adapt `readUsage` to the shape `UsageStateStore` expects. */
export function createTargetReader(deps: ReaderDeps) {
  return (target: UsageTarget, credentials: ResolvedTargetCredential, source: UsageSource): Promise<UsageReading> =>
    readUsage(
      {
        source,
        mode: target.mode,
        apiKey: credentials.apiKey,
        ...(credentials.baseUrl === undefined ? {} : { baseUrl: credentials.baseUrl }),
        ...(credentials.baseUrlPinned === true ? { pinnedBaseUrl: true } : {}),
      },
      deps,
    )
}
