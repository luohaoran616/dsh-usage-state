import test from 'node:test'
import assert from 'node:assert/strict'

import { toSourceCatalog } from '../../src/host/catalog.ts'
import { ALL_SOURCES } from '../../src/host/sources/index.ts'

test('toSourceCatalog turns adapters into plain JSON the browser can consume', () => {
  const catalog = toSourceCatalog(ALL_SOURCES)
  const deepseek = catalog.find(entry => entry.id === 'deepseek')
  const kimi = catalog.find(entry => entry.id === 'kimi')
  const sub2api = catalog.find(entry => entry.id === 'sub2api')

  assert.deepEqual(deepseek, {
    id: 'deepseek',
    displayName: 'DeepSeek',
    modes: ['api'],
    requiresBaseUrl: false,
    defaultBaseUrl: { api: 'https://api.deepseek.com' },
    credentialRefs: { api: ['DEEPSEEK_API_KEY'] },
  })

  assert.deepEqual(kimi?.credentialRefs, {
    api: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    'coding-plan': ['KIMI_CODING_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY'],
  })

  assert.equal(sub2api?.requiresBaseUrl, true)
  assert.deepEqual(sub2api?.defaultBaseUrl, {})
})

test('toSourceCatalog gives every served mode a default endpoint, except where the user must supply one', () => {
  const catalog = toSourceCatalog(ALL_SOURCES)

  for (const entry of catalog) {
    assert.ok(entry.modes.length > 0, `${entry.id} declares no mode`)
    const modesWithDefault = Object.keys(entry.defaultBaseUrl)
    if (entry.requiresBaseUrl) {
      assert.deepEqual(modesWithDefault, [], `${entry.id} requires a user endpoint, so it has no default`)
    } else {
      for (const mode of entry.modes) {
        assert.ok(modesWithDefault.includes(mode), `${entry.id} has no default base URL for ${mode}`)
      }
    }
  }
})

test('toSourceCatalog is JSON-serializable (it crosses an RPC boundary)', () => {
  const catalog = toSourceCatalog(ALL_SOURCES)

  assert.deepEqual(JSON.parse(JSON.stringify(catalog)), catalog)
})
