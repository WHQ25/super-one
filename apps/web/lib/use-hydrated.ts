"use client"

import { useSyncExternalStore } from "react"

/** Nothing ever changes after hydration, so the store never notifies. */
const subscribe = () => () => {}
const getSnapshot = () => true
const getServerSnapshot = () => false

/**
 * False while server-rendering and through hydration, true afterwards.
 *
 * This is the `const [mounted, setMounted] = useState(false)` +
 * `useEffect(() => setMounted(true), [])` pattern, written the way React
 * intends: the server/client difference is declared through
 * `useSyncExternalStore`'s two snapshots rather than produced by a setState in
 * an effect, which schedules a second render pass on every mount.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
