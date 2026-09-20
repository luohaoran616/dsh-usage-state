import { useEffect, useState } from 'react'

import type { SettingsSource } from './context.ts'

/** Re-render on every store publication. */
export function useStoreState<S>(store: { getSnapshot(): S; subscribe(listener: () => void): () => void }): S {
  const [state, setState] = useState<S>(() => store.getSnapshot())
  useEffect(() => store.subscribe(() => setState(store.getSnapshot())), [store])
  return state
}

/** A settings snapshot, kept current with the host document. */
export function useSettingsValue<S>(scope: SettingsSource<S>): S {
  const [snapshot, setSnapshot] = useState(() => scope.getSnapshot())
  useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope])
  return snapshot
}

/**
 * A ticking clock, so reset countdowns stay honest without re-rendering on
 * every frame. The client composition has no timer service, so this is a plain
 * interval cleaned up with the effect.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
