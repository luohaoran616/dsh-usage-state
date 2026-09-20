import { existsSync, readFileSync } from 'node:fs'

import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Guards the *shipped* artifacts. The bundles are committed because
 * `dsh plugin add github:...` installs straight from the repository with no build
 * step, so a broken or mis-wrapped bundle would ship silently.
 *
 * Run `npm run build` first; without `lib/` these checks are skipped rather than
 * failed, so a fresh checkout can still run the unit tests.
 */
const CLIENT = new URL('../../lib/client.js', import.meta.url)
const HOST = new URL('../../lib/index.js', import.meta.url)
const TYPERT = new URL('../../lib/typert.js', import.meta.url)
const PACKAGE = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  name: string
  main?: string
  exports?: Record<string, unknown>
  dsh?: { bundle?: { patch?: string }; client?: { platform?: string; inject?: string[] } }
  dependencies?: Record<string, string>
}

/** Exactly the modules the shell's require table provides. */
const ALLOWED_CLIENT_REQUIRES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

function built(): boolean {
  return existsSync(CLIENT) && existsSync(HOST) && existsSync(TYPERT)
}

test('the browser bundle is wrapped in the module-loader envelope', t => {
  if (!built()) return t.skip('run `npm run build` first')
  const code = readFileSync(CLIENT, 'utf8')

  assert.match(code, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(code, new RegExp(`id: "${PACKAGE.name}"`))
  assert.match(code, /factory: \(require\) => \{/)
  // The bundler reformats the footer, so match its shape rather than its bytes.
  assert.match(code, /return module\.exports;\s*\}\s*\}\);\s*$/)
})

test('the browser bundle requires nothing outside the shell module table', t => {
  if (!built()) return t.skip('run `npm run build` first')
  const code = readFileSync(CLIENT, 'utf8')
  const requires = [...code.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])

  assert.ok(requires.length > 0, 'expected the bundle to require react at least')
  for (const specifier of requires) {
    assert.ok(ALLOWED_CLIENT_REQUIRES.has(specifier as string), `unexpected client require: ${specifier}`)
  }
  assert.doesNotMatch(code, /from\s*"node:/, 'the browser bundle must not reference node builtins')
})

test('the host bundle is ESM exporting the cordis entry points', t => {
  if (!built()) return t.skip('run `npm run build` first')
  const code = readFileSync(HOST, 'utf8')

  assert.match(code, /export \{ apply, /)
  assert.match(code, /inject/)
  assert.doesNotMatch(code, /require\(/, 'the host bundle should be ESM')
})

test('the typert bundle exports the named manifest and keeps zod external', t => {
  if (!built()) return t.skip('run `npm run build` first')
  const code = readFileSync(TYPERT, 'utf8')

  assert.match(code, /export \{[^}]*TYPERT[^}]*\}/)
  assert.match(code, /from "zod"/)
  assert.equal(PACKAGE.dependencies?.zod, '4.5.1', 'the host codecs need zod v4 as a real dependency')
})

test('every declared export and manifest path exists once built', t => {
  if (!built()) return t.skip('run `npm run build` first')

  for (const [key, value] of Object.entries(PACKAGE.exports ?? {})) {
    const target = typeof value === 'string' ? value : (value as { default?: string }).default
    assert.ok(target !== undefined, `export ${key} has no default target`)
    assert.ok(existsSync(new URL(`../../${target}`, import.meta.url)), `export ${key} points at a missing file: ${target}`)
  }
  assert.equal(PACKAGE.main, 'lib/index.js')
  assert.ok(existsSync(new URL(`../../${PACKAGE.dsh?.bundle?.patch ?? ''}`, import.meta.url)))
  assert.equal(PACKAGE.dsh?.client?.platform, 'web')
})

/**
 * The shipped host bundle, driven by a fake cordis context. This catches
 * packaging mistakes (a missing dependency, an accidental bundling of platform
 * code) that unit tests over `src/` cannot see.
 */
test('the built host bundle wires up and reads a balance through a fake host', async t => {
  if (!built()) return t.skip('run `npm run build` first')

  const mod = (await import(HOST.href)) as {
    createUsageState: (ctx: unknown, deps: unknown) => { getState(force: boolean): Promise<unknown> }
  }

  const provided = new Map<string, unknown>()
  const scope = {
    get: () => ({
      models: [{ provider: 'deepseek-official', model: 'deepseek-flash', sourceId: 'deepseek', mode: 'api' }],
    }),
    watch: () => () => undefined,
  }
  const ctx = {
    inject: (names: readonly string[], callback: (ctx: unknown) => void) => {
      if (names.includes('settings')) callback({ settings: { register: () => scope } })
    },
    get: (name: string) =>
      name === 'credentials'
        ? {
            resolve: async (ref: string) => (ref === 'DEEPSEEK_API_KEY' ? { value: 'sk-test', source: 'env' } : undefined),
            describe: async () => ({ configured: true, writable: true }),
          }
        : undefined,
    on: () => () => undefined,
    effect: (callback: () => void) => callback(),
    provide: (key: string, value: unknown) => provided.set(key, value),
    timeout: () => () => undefined,
    interval: () => () => undefined,
  }

  const urls: string[] = []
  const service = mod.createUsageState(ctx, {
    fetch: async (url: string) => {
      urls.push(url)
      return { ok: true, status: 200, json: async () => ({ balance_infos: [{ currency: 'CNY', total_balance: '66.28' }] }) }
    },
    credentialFallback: false,
  })

  const state = (await service.getState(false)) as {
    snapshots: Record<string, { balances: Array<{ amount: number; currency: string }> }>
    sources: unknown[]
  }

  assert.deepEqual(urls, ['https://api.deepseek.com/user/balance'])
  assert.deepEqual(state.snapshots['deepseek:api']?.balances, [{ amount: 66.28, currency: 'CNY' }])
  assert.equal(state.sources.length, 4)
  assert.equal(provided.get('usageState'), service)
  const builtBinding = (service as unknown as { typertRemote?: { service: unknown; serviceKey: string; namespace: string } })
    .typertRemote
  assert.equal(builtBinding?.service, service, 'binding.service must be the service object itself')
  assert.equal(builtBinding?.serviceKey, 'usageState')
  assert.equal(builtBinding?.namespace, 'usageState')
})
