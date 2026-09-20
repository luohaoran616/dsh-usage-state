import test from 'node:test'
import assert from 'node:assert/strict'

import {
  installUsageStateSettings,
  USAGE_STATE_NS,
  usageStateSchema,
  type HostContextLike,
  type SettingsScopeLike,
} from '../../src/host/settings.ts'
import { DEFAULT_CONFIG, type UsageStateConfig } from '../../src/shared/config.ts'

test('the namespace is the one the client binds and satisfies the platform grammar', () => {
  assert.equal(USAGE_STATE_NS, 'usage-state')
  assert.match(USAGE_STATE_NS, /^[a-z][a-z0-9-]*$/)
})

test('the settings schema is callable, normalizes, and serializes', () => {
  assert.equal(typeof usageStateSchema, 'function')
  assert.deepEqual(usageStateSchema({}), DEFAULT_CONFIG)
  assert.deepEqual(usageStateSchema('garbage'), DEFAULT_CONFIG)
  assert.deepEqual(
    usageStateSchema({ display: { progressBar: false } }).display.progressBar,
    false,
  )
  const serialized = usageStateSchema.toJSON()
  assert.equal(typeof serialized, 'object')
  assert.notEqual(serialized, null)
})

function hostStub(scope: SettingsScopeLike | undefined): { ctx: HostContextLike; registered: string[] } {
  const registered: string[] = []
  const ctx: HostContextLike = {
    inject(names, callback) {
      assert.deepEqual(names, ['settings'])
      registered.push(...names)
      if (scope !== undefined) callback({ settings: { register: () => scope } })
    },
  }
  return { ctx, registered }
}

function scopeStub(initial: unknown): { scope: SettingsScopeLike; emit: (next: unknown) => void } {
  let watcher: ((next: unknown, prev: unknown) => void) | undefined
  let current = initial
  return {
    scope: {
      get: () => current,
      watch: callback => {
        watcher = callback
        return () => {
          watcher = undefined
        }
      },
    },
    emit: next => {
      const prev = current
      current = next
      watcher?.(next, prev)
    },
  }
}

test('installing the settings keeps a live config snapshot, starting from the stored value', () => {
  const { scope, emit } = scopeStub({ display: { progressBar: false } })
  const { ctx } = hostStub(scope)
  const seen: UsageStateConfig[] = []

  installUsageStateSettings(ctx, config => seen.push(config))

  assert.equal(seen.length, 1)
  assert.equal(seen[0]?.display.progressBar, false)

  emit({ refresh: { intervalMinutes: 15 } })
  assert.equal(seen.length, 2)
  assert.equal(seen[1]?.refresh.intervalMinutes, 15)
  assert.equal(seen[1]?.display.progressBar, true)
})

test('installing is a no-op on a host without a settings provider', () => {
  const { ctx, registered } = hostStub(undefined)
  let called = 0

  installUsageStateSettings(ctx, () => {
    called += 1
  })

  assert.deepEqual(registered, ['settings'])
  assert.equal(called, 0)
})
