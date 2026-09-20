import { readFile } from 'node:fs/promises'

import test from 'node:test'
import assert from 'node:assert/strict'
import { validateTypertManifest } from '@deepseek-ai/dsh-typert-loader'

import {
  credentialReportSchema,
  TYPERT,
  TYPERT_NAMESPACE,
  TYPERT_PACKAGE,
  TYPERT_SERVICE,
  usageStateViewSchema,
} from '../../src/host/typert.ts'

const RESERVED_METHODS = new Set(['ctx', 'empty', 'invokeRemote', 'methods', 'name', 'namespace'])

/** Mirrors the loader's `requireStrictCodec` check so a manifest change cannot silently drift. */
function assertStrictCodec(codec: unknown, label: string): void {
  const candidate = codec as { mode?: unknown; typeSymbol?: unknown; schema?: { parse?: unknown; _zod?: unknown } }
  assert.equal(candidate.mode, 'strict', `${label} must be a strict codec`)
  assert.equal(typeof candidate.typeSymbol, 'string', `${label} must carry a typeSymbol`)
  assert.ok((candidate.typeSymbol as string).length > 0, `${label} typeSymbol must not be empty`)
  assert.ok('_zod' in (candidate.schema ?? {}), `${label} schema must be a zod v4 schema`)
  assert.equal(typeof candidate.schema?.parse, 'function', `${label} schema must expose parse`)
}

test('the platform validator accepts the manifest as-is', () => {
  // The real validator, not a copy of its rules: this is what the loader runs at
  // boot, so a manifest change that would break plugin load fails here first.
  assert.doesNotThrow(() => validateTypertManifest(TYPERT_PACKAGE, TYPERT))
})

test('the host manifest declares the package, face and empty model the loader requires', () => {
  assert.equal(TYPERT.package, TYPERT_PACKAGE)
  assert.equal(TYPERT.face, 'host')
  assert.deepEqual(TYPERT.schemas, [])
  assert.deepEqual(TYPERT.model, { services: [], events: [], objects: [] })
  assert.equal(TYPERT.package, 'dsh-usage-state')
})

test('package.json exposes the manifest where the typert loader looks for it', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as {
    name?: string
    exports?: Record<string, unknown>
    dependencies?: Record<string, string>
  }

  assert.equal(manifest.name, TYPERT.package, 'TYPERT.package must equal the npm name')
  assert.ok(manifest.exports?.['./typert'] !== undefined, 'package.json must export ./typert')
  assert.equal(manifest.dependencies?.zod, '4.5.1', 'the host codecs require zod v4')
})

test('every invocation is well formed and uses strict codecs', () => {
  assert.ok(TYPERT.invocations.length >= 2)

  for (const invocation of TYPERT.invocations) {
    assert.equal(invocation.id, `${TYPERT.package}#${TYPERT_NAMESPACE}/${invocation.method}`)
    assert.equal(invocation.service, TYPERT_SERVICE)
    assert.equal(invocation.namespace, TYPERT_NAMESPACE)
    assert.equal(invocation.invocation.kind, 'direct')
    assert.ok(!RESERVED_METHODS.has(invocation.method), `${invocation.method} is a reserved method name`)

    for (const parameter of invocation.parameters) {
      assert.equal(parameter.source, 'json')
      assert.equal(parameter.name, parameter.wire)
      assertStrictCodec(parameter.codec, `${invocation.method}.${parameter.name}`)
    }
    assertStrictCodec(invocation.result, `${invocation.method} result`)
  }
})

test('getState takes one omittable boolean so the client can poll without forcing', () => {
  const getState = TYPERT.invocations.find(invocation => invocation.method === 'getState')

  assert.ok(getState !== undefined)
  assert.equal(getState.parameters.length, 1)
  const parameter = getState.parameters[0]
  assert.equal(parameter?.name, 'force')
  assert.equal(parameter?.acceptsUndefined, true)
  assert.equal(parameter?.codec.schema.parse(undefined), undefined)
  assert.equal(parameter?.codec.schema.parse(true), true)
})

test('describeCredentials takes no arguments', () => {
  const describe = TYPERT.invocations.find(invocation => invocation.method === 'describeCredentials')

  assert.ok(describe !== undefined)
  assert.deepEqual(describe.parameters, [])
})

test('the declared result schemas accept the real payload shapes', () => {
  const view = {
    sources: [
      {
        id: 'deepseek',
        displayName: 'DeepSeek',
        modes: ['api'],
        requiresBaseUrl: false,
        defaultBaseUrl: { api: 'https://api.deepseek.com' },
        credentialRefs: { api: ['DEEPSEEK_API_KEY'] },
      },
    ],
    snapshots: {
      'deepseek:api': {
        sourceId: 'deepseek',
        mode: 'api',
        balances: [{ amount: 66.28, currency: 'CNY' }],
        windows: [{ id: '5h', usedPercent: 42, resetsAt: 1_758_384_000_000 }],
        fetchedAt: 1_758_380_000_000,
        stale: true,
        error: { kind: 'network', detail: 'offline' },
      },
    },
    checkedAt: 1_758_380_000_000,
  }

  assert.deepEqual(usageStateViewSchema.parse(view), view)

  const report = {
    credentials: {
      'deepseek:api': {
        candidates: [{ ref: 'DEEPSEEK_API_KEY', configured: true, source: 'env' }],
        configured: true,
        ref: 'DEEPSEEK_API_KEY',
        source: 'env',
      },
      'zai:coding-plan': { candidates: [{ ref: 'ZAI_API_KEY', configured: false }], configured: false },
    },
  }

  assert.deepEqual(credentialReportSchema.parse(report), report)
})

test('the result schema rejects a malformed snapshot', () => {
  assert.throws(() => usageStateViewSchema.parse({ sources: [], snapshots: { a: { sourceId: 1 } }, checkedAt: 0 }))
})
