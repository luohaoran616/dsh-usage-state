import test from 'node:test'
import assert from 'node:assert/strict'

import { providerCredentialRefs } from '../../src/host/provider-refs.ts'

const PI_AI = {
  providers: {
    orcarouter: { apiKeyEnv: 'ORCAROUTER_API_KEY', baseURL: 'https://api.orcarouter.ai/v1', models: [] },
    'glm-coding': { apiKeyEnv: 'GLM_KEY', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
    'kimi-code': { apiKeyEnv: 'KIMI_KEY', baseURL: 'https://api.kimi.com/coding/v1' },
    anonymous: { baseURL: 'https://api.deepseek.com/v1' },
  },
}

test('the llm-deepseek namespace contributes its apiKeyEnv for the deepseek source', () => {
  assert.deepEqual(
    providerCredentialRefs({ sourceId: 'deepseek', deepseekSettings: { apiKeyEnv: 'MY_DS_KEY' } }),
    ['MY_DS_KEY'],
  )
  assert.deepEqual(
    providerCredentialRefs({ sourceId: 'zai', deepseekSettings: { apiKeyEnv: 'MY_DS_KEY' } }),
    [],
  )
})

test('pi-ai providers contribute their apiKeyEnv when the provider resolves to the source', () => {
  assert.deepEqual(providerCredentialRefs({ sourceId: 'sub2api', piAiSettings: PI_AI }), ['ORCAROUTER_API_KEY'])
  assert.deepEqual(providerCredentialRefs({ sourceId: 'zai', piAiSettings: PI_AI }), ['GLM_KEY'])
  assert.deepEqual(providerCredentialRefs({ sourceId: 'kimi', piAiSettings: PI_AI }), ['KIMI_KEY'])
})

test('a provider without apiKeyEnv contributes nothing, and order follows the document', () => {
  assert.deepEqual(providerCredentialRefs({ sourceId: 'deepseek', piAiSettings: PI_AI }), [])
})

test('refs are trimmed, deduplicated and never invented from non-strings', () => {
  assert.deepEqual(
    providerCredentialRefs({
      sourceId: 'deepseek',
      deepseekSettings: { apiKeyEnv: ' DEEPSEEK_API_KEY ' },
      piAiSettings: { providers: { a: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com' } } },
    }),
    ['DEEPSEEK_API_KEY'],
  )
  assert.deepEqual(
    providerCredentialRefs({
      sourceId: 'deepseek',
      deepseekSettings: { apiKeyEnv: 42 },
      piAiSettings: { providers: { a: { apiKeyEnv: '', baseURL: 'https://api.deepseek.com' } } },
    }),
    [],
  )
})

test('malformed settings documents are simply ignored', () => {
  for (const input of [
    { sourceId: 'deepseek' },
    { sourceId: 'deepseek', deepseekSettings: null, piAiSettings: 'nope' },
    { sourceId: 'deepseek', deepseekSettings: [], piAiSettings: { providers: [] } },
    { sourceId: 'deepseek', piAiSettings: { providers: { a: null, b: 'x' } } },
  ]) {
    assert.deepEqual(providerCredentialRefs(input), [], `expected nothing for ${JSON.stringify(input)}`)
  }
})

test('a caller-supplied resolver replaces the built-in suggestion', () => {
  const refs = providerCredentialRefs({
    sourceId: 'zai',
    piAiSettings: PI_AI,
    suggest: (providerId, baseUrl) => (providerId === 'orcarouter' && baseUrl === undefined ? 'zai' : undefined),
  })

  assert.deepEqual(refs, [])
})
