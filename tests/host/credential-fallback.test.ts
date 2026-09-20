import test from 'node:test'
import assert from 'node:assert/strict'

import { refFromCredentialsDocument, withCredentialFallback } from '../../src/host/credential-fallback.ts'
import type { CredentialLookup } from '../../src/host/credentials.ts'

const DOCUMENT = `version: 1
records:
  client-connection/browser-session:
    kind: grant
    payload:
      secret: not-a-ref
refs:
  DEEPSEEK_API_KEY: sk-abc123
  ZAI_API_KEY: "sk-quoted"
  EMPTY_KEY:
  NULL_KEY: null
`

test('refFromCredentialsDocument reads only the refs block', () => {
  assert.equal(refFromCredentialsDocument(DOCUMENT, 'DEEPSEEK_API_KEY'), 'sk-abc123')
  assert.equal(refFromCredentialsDocument(DOCUMENT, 'ZAI_API_KEY'), 'sk-quoted')
  assert.equal(refFromCredentialsDocument(DOCUMENT, 'EMPTY_KEY'), undefined)
  assert.equal(refFromCredentialsDocument(DOCUMENT, 'NULL_KEY'), undefined)
  // A value that merely looks like a ref name must not leak out of `records:`.
  assert.equal(refFromCredentialsDocument(DOCUMENT, 'secret'), undefined)
  assert.equal(refFromCredentialsDocument('', 'DEEPSEEK_API_KEY'), undefined)
  assert.equal(refFromCredentialsDocument('not yaml at all', 'DEEPSEEK_API_KEY'), undefined)
})

function platformLookup(answer: { value?: string; source?: string } = {}): CredentialLookup {
  return {
    resolve: async () => (answer.value === undefined ? undefined : { value: answer.value, source: answer.source ?? 'file' }),
    describe: async () =>
      answer.value === undefined
        ? { configured: false, writable: true }
        : { configured: true, source: answer.source ?? 'file', writable: true },
  }
}

test('the platform answer always wins', async () => {
  const lookup = withCredentialFallback(platformLookup({ value: 'sk-platform', source: 'file' }), {
    environment: { DEEPSEEK_API_KEY: 'sk-env' },
    credentialsPath: '/nonexistent',
  })

  assert.deepEqual(await lookup.resolve('DEEPSEEK_API_KEY'), { value: 'sk-platform', source: 'file' })
})

test('the environment is the first fallback, matching the platform precedence', async () => {
  const lookup = withCredentialFallback(platformLookup(), {
    environment: { DEEPSEEK_API_KEY: 'sk-env' },
    credentialsPath: '/nonexistent',
  })

  assert.deepEqual(await lookup.resolve('DEEPSEEK_API_KEY'), { value: 'sk-env', source: 'env (direct)' })
  assert.deepEqual(await lookup.describe('DEEPSEEK_API_KEY'), {
    configured: true,
    source: 'env (direct)',
    writable: false,
  })
})

test('when only the credentials file has the ref, it is read directly and labelled', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const dir = mkdtempSync(join(tmpdir(), 'usage-state-credentials-'))
  const path = join(dir, '.credentials.yaml')
  writeFileSync(path, DOCUMENT, 'utf8')

  const lookup = withCredentialFallback(platformLookup(), { environment: {}, credentialsPath: path })

  assert.deepEqual(await lookup.resolve('DEEPSEEK_API_KEY'), { value: 'sk-abc123', source: 'file (direct)' })
  assert.equal((await lookup.describe('DEEPSEEK_API_KEY')).configured, true)
  assert.deepEqual(await lookup.resolve('MISSING_KEY'), undefined)
})

test('a missing or unreadable file is simply "not configured"', async () => {
  const lookup = withCredentialFallback(platformLookup(), { environment: {}, credentialsPath: '/definitely/not/here.yaml' })

  assert.equal(await lookup.resolve('DEEPSEEK_API_KEY'), undefined)
  assert.deepEqual(await lookup.describe('DEEPSEEK_API_KEY'), { configured: false, writable: true })
})
