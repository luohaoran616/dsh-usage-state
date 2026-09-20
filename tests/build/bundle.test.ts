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
