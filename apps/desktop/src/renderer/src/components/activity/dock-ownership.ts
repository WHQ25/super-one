/**
 * Who opened what in each session's dock, and the layout changes waiting for a
 * session that is not on screen.
 *
 * Kept free of store imports so the dock API and the per-session view store can
 * both reach it without an import cycle.
 */

/** `agent`, or `miniapp:<appId>` for a mini-app acting through its host API. */
export type DockOpener = string

const openers = new Map<string, DockOpener>()

function key(sessionId: string, id: string): string {
  return `${sessionId}\u0000${id}`
}

/** Remember that `opener` put this tab (or split pane) into the session's layout. */
export function recordDockOpener(sessionId: string, id: string, opener: DockOpener): void {
  openers.set(key(sessionId, id), opener)
}

/** Null when the user opened it, or when nothing records an opener. */
export function dockOpener(sessionId: string, id: string): DockOpener | null {
  return openers.get(key(sessionId, id)) ?? null
}

export function forgetDockOpener(sessionId: string, id: string): void {
  openers.delete(key(sessionId, id))
}

/**
 * A change to a parked layout, replayed when the session is next shown. The
 * dockview of a parked session exists only as JSON, so instead of editing that
 * JSON each change runs against the live dock the moment it belongs to the session.
 */
export interface QueuedDockChange {
  kind: 'open' | 'close' | 'focus' | 'split' | 'maximize' | 'restore'
  /** Target tab; for `open`, the tab it will create. */
  tab?: string
  /** For `open`: how the tab will be listed until it exists. */
  preview?: { kind: string; title: string }
  run: () => void
}

const queues = new Map<string, QueuedDockChange[]>()

export function queueDockChange(sessionId: string, change: QueuedDockChange): void {
  const queue = queues.get(sessionId) ?? []
  queue.push(change)
  queues.set(sessionId, queue)
}

export function queuedDockChanges(sessionId: string): readonly QueuedDockChange[] {
  return queues.get(sessionId) ?? []
}

/** Run a session's queued changes against the live dock, in order. One failure does not stop the rest. */
export function drainDockChanges(sessionId: string): void {
  const queue = queues.get(sessionId)
  if (!queue) return
  queues.delete(sessionId)
  for (const change of queue) {
    try {
      change.run()
    } catch (err) {
      console.warn('[layout-control] queued layout change failed', change.kind, change.tab, err)
    }
  }
}

export function clearDockChanges(sessionId: string): void {
  queues.delete(sessionId)
}

export function _resetDockOwnershipForTest(): void {
  openers.clear()
  queues.clear()
}
