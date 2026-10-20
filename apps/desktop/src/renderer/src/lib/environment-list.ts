import type { EnvironmentListItem } from '@superone/shared/environment'

/**
 * One environment list for every sidebar row, chip, and settings page.
 * A session switch remounts those hooks; they share this result until a
 * supervisor status push says a node actually changed.
 */

type Listener = (snapshot: { connectionId: string }) => void

let items: EnvironmentListItem[] | null = null
let inflight: Promise<EnvironmentListItem[]> | null = null
let epoch = 0
let bound: object | null = null
let unsubscribeStatus: (() => void) | null = null
const listeners = new Set<Listener>()

function drop(): void {
  epoch += 1
  items = null
  inflight = null
}

function bindStatus(): void {
  unsubscribeStatus?.()
  bound = window.environment
  unsubscribeStatus = window.environment.onStatusEvent((snapshot) => {
    drop()
    for (const listener of [...listeners]) listener(snapshot)
  })
}

function syncBinding(): void {
  if (bound !== window.environment) {
    drop()
    unsubscribeStatus?.()
    unsubscribeStatus = null
    bound = window.environment
  }
  if (listeners.size > 0 && !unsubscribeStatus) bindStatus()
  if (listeners.size === 0 && unsubscribeStatus) {
    unsubscribeStatus()
    unsubscribeStatus = null
    drop()
  }
}

/** Cached list for the current status epoch. Concurrent callers share one IPC. */
export function loadEnvironmentItems(): Promise<EnvironmentListItem[]> {
  syncBinding()
  if (items) return Promise.resolve(items)
  if (inflight) return inflight
  const started = epoch
  const promise = window.environment.listItems().then((next) => {
    if (started === epoch) items = next
    return next
  }).finally(() => {
    if (inflight === promise) inflight = null
  })
  inflight = promise
  return promise
}

/**
 * Re-read after the next status push. The bridge is installed only while
 * someone is listening, so a test that replaces `window.environment` binds
 * the new mock on the next subscribe.
 */
export function subscribeEnvironmentList(listener: Listener): () => void {
  listeners.add(listener)
  syncBinding()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      unsubscribeStatus?.()
      unsubscribeStatus = null
      drop()
    }
  }
}

/** Test isolation. Production never calls this. */
export function resetEnvironmentListCache(): void {
  listeners.clear()
  unsubscribeStatus?.()
  unsubscribeStatus = null
  bound = null
  drop()
}
