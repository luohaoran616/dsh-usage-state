import test from 'node:test'
import assert from 'node:assert/strict'

import {
  describeCredentials,
  orderedCredentialRefs,
  resolveApiKey,
  type CredentialLookup,
} from '../../src/host/credentials.ts'
import { deepseek } from '../../src/host/sources/deepseek.ts'
import { kimi } from '../../src/host/sources/kimi.ts'

function lookupFrom(entries: Record<string, string | { value: string; source: string }>): CredentialLookup {
  return {
    async resolve(ref) {
      const hit = entries[ref]
      if (hit === undefined) return undefined
      return typeof hit === 'string' ? { value: hit, source: 'store' } : hit
    },
    async describe(ref) {
      const hit = entries[ref]
      if (hit === undefined) return { configured: false, writable: true }
      return { configured: true, source: typeof hit === 'string' ? 'store' : hit.source, writable: true }
    },
  }
}

test('orderedCredentialRefs prefers the override, then provider env refs, then the source defaults', () => {
  assert.deepEqual(orderedCredentialRefs(deepseek, 'api'), ['DEEPSEEK_API_KEY'])
  assert.deepEqual(orderedCredentialRefs(deepseek, 'api', { preferredRefs: ['MY_DS_KEY'] }), [
    'MY_DS_KEY',
    'DEEPSEEK_API_KEY',
  ])
  assert.deepEqual(
    orderedCredentialRefs(deepseek, 'api', { overrideRef: 'TEAM_KEY', preferredRefs: ['MY_DS_KEY'] }),
    ['TEAM_KEY', 'MY_DS_KEY', 'DEEPSEEK_API_KEY'],
  )
})

test('orderedCredentialRefs drops duplicates and blank refs', () => {
  assert.deepEqual(
    orderedCredentialRefs(deepseek, 'api', { overrideRef: 'DEEPSEEK_API_KEY', preferredRefs: ['  ', 'X', 'X'] }),
    ['DEEPSEEK_API_KEY', 'X'],
  )
})

test('resolveApiKey returns the first ref that resolves, with its origin', async () => {
  const lookup = lookupFrom({ MY_DS_KEY: { value: 'sk-team', source: 'env' } })

  const resolved = await resolveApiKey(deepseek, 'api', { preferredRefs: ['MY_DS_KEY'] }, lookup)

  assert.deepEqual(resolved, { apiKey: 'sk-team', ref: 'MY_DS_KEY', origin: 'env' })
})

test('resolveApiKey lets an explicit override beat a resolvable built-in ref', async () => {
  const lookup = lookupFrom({ TEAM_KEY: 'sk-team', DEEPSEEK_API_KEY: 'sk-personal' })

  const resolved = await resolveApiKey(deepseek, 'api', { overrideRef: 'TEAM_KEY' }, lookup)

  assert.equal(resolved?.apiKey, 'sk-team')
  assert.equal(resolved?.ref, 'TEAM_KEY')
})

test('resolveApiKey follows the mode, so Kimi coding-plan prefers its own key', async () => {
  const lookup = lookupFrom({ KIMI_CODING_API_KEY: 'sk-kimi', MOONSHOT_API_KEY: 'sk-moonshot' })

  const codingPlan = await resolveApiKey(kimi, 'coding-plan', {}, lookup)
  const api = await resolveApiKey(kimi, 'api', {}, lookup)

  assert.equal(codingPlan?.ref, 'KIMI_CODING_API_KEY')
  assert.equal(api?.ref, 'MOONSHOT_API_KEY')
})

test('resolveApiKey reports nothing when no candidate is configured', async () => {
  const resolved = await resolveApiKey(deepseek, 'api', {}, lookupFrom({}))

  assert.equal(resolved, undefined)
})

test('resolveApiKey ignores blank and whitespace-only secrets', async () => {
  const lookup = lookupFrom({ DEEPSEEK_API_KEY: '   ', SECOND: 'sk-real' })

  const resolved = await resolveApiKey(deepseek, 'api', { preferredRefs: ['SECOND'] }, lookup)

  assert.equal(resolved?.apiKey, 'sk-real')
  assert.equal(await resolveApiKey(deepseek, 'api', {}, lookupFrom({ DEEPSEEK_API_KEY: '' })), undefined)
})

test('describeCredentials lists every candidate with its status and never a value', async () => {
  const lookup = lookupFrom({ DEEPSEEK_API_KEY: { value: 'sk-secret', source: 'env' } })

  const described = await describeCredentials(deepseek, 'api', { preferredRefs: ['MY_DS_KEY'] }, lookup)

  assert.deepEqual(described, {
    candidates: [
      { ref: 'MY_DS_KEY', configured: false, writable: true },
      { ref: 'DEEPSEEK_API_KEY', configured: true, source: 'env', writable: true },
    ],
    configured: true,
    ref: 'DEEPSEEK_API_KEY',
    source: 'env',
    writable: true,
  })
  assert.equal(JSON.stringify(described).includes('sk-secret'), false)
})

test('describeCredentials reports an unconfigured target when nothing resolves', async () => {
  const described = await describeCredentials(kimi, 'coding-plan', {}, lookupFrom({}))

  assert.equal(described.configured, false)
  assert.equal(described.ref, undefined)
  assert.deepEqual(
    described.candidates.map(candidate => candidate.ref),
    ['KIMI_CODING_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY'],
  )
})

test('an environment-supplied credential is reported as not writable', async () => {
  const lookup: CredentialLookup = {
    resolve: async () => ({ value: 'sk-from-env', source: 'env' }),
    describe: async () => ({ configured: true, source: 'env', writable: false }),
  }

  const described = await describeCredentials(deepseek, 'api', {}, lookup)

  assert.equal(described.writable, false)
  assert.deepEqual(described.candidates, [{ ref: 'DEEPSEEK_API_KEY', configured: true, source: 'env', writable: false }])
})
