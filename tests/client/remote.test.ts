import test from 'node:test'
import assert from 'node:assert/strict'

import { remoteService } from '../../src/client/remote.ts'

test('remoteService returns the namespace the context holds', () => {
  const service = { getState: () => undefined }
  const ctx = { get: (name: string) => (name === 'remote.usageState' ? service : undefined) }

  assert.equal(remoteService(ctx, 'remote.usageState'), service)
})

test('remoteService reports absence instead of throwing before a mount lands', () => {
  assert.equal(remoteService({ get: () => undefined }, 'remote.usageState'), undefined)
})

test('remoteService swallows the cordis "without inject" error', () => {
  const ctx = {
    get() {
      throw new Error('cannot get property "remote.usageState" without inject')
    },
  }

  assert.equal(remoteService(ctx, 'remote.usageState'), undefined)
})
