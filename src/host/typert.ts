import { z } from 'zod'

/**
 * The host half of the Typert RPC contract.
 *
 * Three requirements here are not obvious and are load-bearing:
 *  - the module must export a NAMED `TYPERT`, and `package.json` must expose it
 *    as `exports["./typert"]` — that is where the loader looks;
 *  - `package` must equal the npm package name exactly;
 *  - every parameter and result codec must be "strict" and carry a zod **v4**
 *    schema (the loader checks `'_zod' in schema`), which is why zod is a runtime
 *    dependency rather than a dev one.
 *
 * `model` is mandatory even when empty.
 */

export const TYPERT_PACKAGE = 'dsh-usage-state'
export const TYPERT_SERVICE = 'usageState'
export const TYPERT_NAMESPACE = 'usageState'

export interface StrictCodec {
  mode: 'strict'
  typeSymbol: string
  schema: { parse(value: unknown): unknown; _zod?: unknown }
  create(): unknown
}

export function strictCodec(name: string, schema: z.ZodType): StrictCodec {
  return { mode: 'strict', typeSymbol: `${TYPERT_PACKAGE}#${name}`, schema, create: () => schema }
}

const usageModeSchema = z.enum(['api', 'coding-plan'])

const balanceSchema = z.object({ amount: z.number(), currency: z.string() })

const quotaWindowSchema = z.object({
  id: z.string(),
  usedPercent: z.number(),
  resetsAt: z.number().optional(),
})

const snapshotErrorSchema = z.object({
  kind: z.enum(['config', 'auth', 'http', 'network', 'parse', 'unknown']),
  detail: z.string().optional(),
})

const snapshotSchema = z.object({
  sourceId: z.string(),
  mode: usageModeSchema,
  balances: z.array(balanceSchema),
  windows: z.array(quotaWindowSchema),
  fetchedAt: z.number(),
  stale: z.boolean().optional(),
  error: snapshotErrorSchema.optional(),
})

const catalogEntrySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  modes: z.array(usageModeSchema),
  requiresBaseUrl: z.boolean(),
  defaultBaseUrl: z.record(z.string(), z.string()),
  credentialRefs: z.record(z.string(), z.array(z.string())),
})

const credentialCandidateSchema = z.object({
  ref: z.string(),
  configured: z.boolean(),
  source: z.string().optional(),
  writable: z.boolean().optional(),
})

const credentialDescriptionSchema = z.object({
  candidates: z.array(credentialCandidateSchema),
  configured: z.boolean(),
  ref: z.string().optional(),
  source: z.string().optional(),
  writable: z.boolean().optional(),
})

export const usageStateViewSchema = z.object({
  sources: z.array(catalogEntrySchema),
  snapshots: z.record(z.string(), snapshotSchema),
  checkedAt: z.number(),
})

export const credentialReportSchema = z.object({
  credentials: z.record(z.string(), credentialDescriptionSchema),
})

export const TYPERT = {
  package: TYPERT_PACKAGE,
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [
    {
      id: `${TYPERT_PACKAGE}#${TYPERT_NAMESPACE}/getState`,
      service: TYPERT_SERVICE,
      namespace: TYPERT_NAMESPACE,
      method: 'getState',
      invocation: { kind: 'direct' as const },
      // The client must always pass `force` (arity is exact) but may pass
      // undefined, which is what `acceptsUndefined` is for.
      parameters: [
        {
          name: 'force',
          wire: 'force',
          source: 'json' as const,
          acceptsUndefined: true,
          codec: strictCodec('Force', z.boolean().optional()),
        },
      ],
      result: strictCodec('UsageStateView', usageStateViewSchema),
    },
    {
      id: `${TYPERT_PACKAGE}#${TYPERT_NAMESPACE}/describeCredentials`,
      service: TYPERT_SERVICE,
      namespace: TYPERT_NAMESPACE,
      method: 'describeCredentials',
      invocation: { kind: 'direct' as const },
      parameters: [],
      result: strictCodec('CredentialReport', credentialReportSchema),
    },
  ],
}
