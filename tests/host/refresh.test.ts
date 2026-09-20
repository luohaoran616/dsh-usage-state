import test from 'node:test'
import assert from 'node:assert/strict'

import { UsageStateStore, type RefreshClock, type RefreshPolicy } from '../../src/host/refresh.ts'
import { deepseek } from '../../src/host/sources/deepseek.ts'
import { SourceError } from '../../src/host/sources/types.ts'
import { targetKey, type UsageTarget } from '../../src/host/targets.ts'
import type { UsageReading } from '../../src/shared/types.ts'

const BALANCE: UsageReading = { balances: [{ amount: 66.28, currency: 'CNY' }], windows: [] }
const DS_TARGET: UsageTarget = { key: 'deepseek:api', sourceId: 'deepseek', mode: 'api' }

const POLICY: RefreshPolicy = { intervalMinutes: 5, turnEndDelayMs: 2000, minIntervalSeconds: 60 }

class FakeClock implements RefreshClock {
  private current = 0
  private nextId = 1
  private timers = new Map<number, { at: number; every?: number; fn: () => void }>()

  now(): number {
    return this.current
  }

  after(ms: number, fn: () => void): () => void {
    const id = this.nextId++
    this.timers.set(id, { at: this.current + ms, fn })
    return () => void this.timers.delete(id)
  }

  every(ms: number, fn: () => void): () => void {
    const id = this.nextId++
    this.timers.set(id, { at: this.current + ms, every: ms, fn })
    return () => void this.timers.delete(id)
  }

  get pending(): number {
    return this.timers.size
  }

  async advance(ms: number): Promise<void> {
    const target = this.current + ms
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)
      const next = due[0]
      if (next === undefined) break
      const [id, timer] = next
      this.current = timer.at
      if (timer.every === undefined) this.timers.delete(id)
      else timer.at = timer.at + timer.every
      timer.fn()
      await flush()
    }
    this.current = target
  }
}

async function flush(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

interface HarnessOptions {
  read?: (target: UsageTarget) => Promise<UsageReading>
  credential?: boolean
  policy?: Partial<RefreshPolicy>
}

function harness(options: HarnessOptions = {}) {
  const clock = new FakeClock()
  const calls: UsageTarget[] = []
  const policy = { ...POLICY, ...options.policy }

  const store = new UsageStateStore({
    clock,
    policy: () => policy,
    targets: () => [DS_TARGET],
    findSource: id => (id === 'deepseek' ? deepseek : undefined),
    credentials: {
      resolve: async () =>
        options.credential === false ? undefined : { apiKey: 'sk-test', ref: 'DEEPSEEK_API_KEY', origin: 'store' },
    },
    read: async (target, credentials) => {
      assert.equal(credentials.apiKey, 'sk-test')
      calls.push(target)
      return options.read === undefined ? BALANCE : options.read(target)
    },
  })

  return { clock, store, calls, policy }
}

test('a successful refresh stores the reading with the fetch time', async () => {
  const { store, calls } = harness()

  const snapshot = await store.refresh(DS_TARGET.key)

  assert.equal(calls.length, 1)
  assert.deepEqual(snapshot, {
    sourceId: 'deepseek',
    mode: 'api',
    balances: [{ amount: 66.28, currency: 'CNY' }],
    windows: [],
    fetchedAt: 0,
  })
  assert.deepEqual(store.snapshots()['deepseek:api'], snapshot)
})

test('a failed refresh keeps the last good reading and flags it stale', async () => {
  let fail = false
  const { store, clock } = harness({
    read: async () => {
      if (fail) throw new SourceError('network', 'socket hang up')
      return BALANCE
    },
  })

  await store.refresh(DS_TARGET.key)
  await clock.advance(120_000)
  fail = true
  const snapshot = await store.refresh(DS_TARGET.key, { force: true })

  assert.deepEqual(snapshot.balances, [{ amount: 66.28, currency: 'CNY' }])
  assert.equal(snapshot.stale, true)
  assert.deepEqual(snapshot.error, { kind: 'network', detail: 'socket hang up' })
  assert.equal(snapshot.fetchedAt, 0)
})

test('a first failure reports the error without inventing a reading', async () => {
  const { store } = harness({
    read: async () => {
      throw new SourceError('auth', 'HTTP 401')
    },
  })

  const snapshot = await store.refresh(DS_TARGET.key)

  assert.deepEqual(snapshot.balances, [])
  assert.deepEqual(snapshot.windows, [])
  assert.equal(snapshot.stale, undefined)
  assert.deepEqual(snapshot.error, { kind: 'auth', detail: 'HTTP 401' })
})

test('an unexpected throw is reported as an unknown failure', async () => {
  const { store } = harness({
    read: async () => {
      throw new Error('boom')
    },
  })

  const snapshot = await store.refresh(DS_TARGET.key)

  assert.deepEqual(snapshot.error, { kind: 'unknown', detail: 'boom' })
})

test('a missing credential is a configuration failure and never reaches the network', async () => {
  const { store, calls } = harness({ credential: false })

  const snapshot = await store.refresh(DS_TARGET.key)

  assert.equal(calls.length, 0)
  assert.equal(snapshot.error?.kind, 'config')
})

test('the minimum interval suppresses a second real request', async () => {
  const { store, calls, clock } = harness()

  await store.refresh(DS_TARGET.key)
  await clock.advance(30_000)
  const cached = await store.refresh(DS_TARGET.key)

  assert.equal(calls.length, 1)
  assert.equal(cached.balances.length, 1)

  await clock.advance(31_000)
  await store.refresh(DS_TARGET.key)
  assert.equal(calls.length, 2)
})

test('force bypasses the minimum interval', async () => {
  const { store, calls } = harness()

  await store.refresh(DS_TARGET.key)
  await store.refresh(DS_TARGET.key, { force: true })

  assert.equal(calls.length, 2)
})

test('concurrent refreshes share one request', async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const { store, calls } = harness({
    read: async () => {
      await gate
      return BALANCE
    },
  })

  const first = store.refresh(DS_TARGET.key)
  const second = store.refresh(DS_TARGET.key)
  release?.()
  const [a, b] = await Promise.all([first, second])

  assert.equal(calls.length, 1)
  assert.deepEqual(a, b)
})

test('a failed request does not throttle the next attempt', async () => {
  let fail = true
  const { store, calls } = harness({
    read: async () => {
      if (fail) throw new SourceError('network', 'offline')
      return BALANCE
    },
  })

  await store.refresh(DS_TARGET.key)
  fail = false
  await store.refresh(DS_TARGET.key)

  assert.equal(calls.length, 2)
})

test('a turn ending schedules one delayed refresh, coalescing repeats', async () => {
  const { store, calls, clock, policy } = harness()

  store.onTurnEnd()
  store.onTurnEnd()
  store.onTurnEnd()
  assert.equal(clock.pending, 1)

  await clock.advance(policy.turnEndDelayMs - 1)
  assert.equal(calls.length, 0)

  await clock.advance(1)
  assert.equal(calls.length, 1)
  assert.equal(clock.pending, 0)
})

test('the idle timer refreshes every configured interval until stopped', async () => {
  const { store, calls, clock, policy } = harness()

  const stop = store.start()
  await clock.advance(policy.intervalMinutes * 60_000)
  assert.equal(calls.length, 1)

  await clock.advance(policy.intervalMinutes * 60_000)
  assert.equal(calls.length, 2)

  stop()
  assert.equal(clock.pending, 0)
  await clock.advance(policy.intervalMinutes * 60_000)
  assert.equal(calls.length, 2)
})

test('targets without a configured source are ignored', async () => {
  const clock = new FakeClock()
  const calls: string[] = []
  const store = new UsageStateStore({
    clock,
    policy: () => POLICY,
    targets: () => [
      DS_TARGET,
      { key: 'ghost:api', sourceId: 'ghost', mode: 'api' },
    ],
    findSource: id => (id === 'deepseek' ? deepseek : undefined),
    credentials: { resolve: async () => ({ apiKey: 'k', ref: 'R', origin: 'store' }) },
    read: async target => {
      calls.push(target.key)
      return BALANCE
    },
  })

  await store.refreshAll()

  assert.deepEqual(calls, [targetKey('deepseek', 'api')])
})
