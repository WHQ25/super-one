import { CollaborationError } from './errors'
import type { CollaborationGrantRow, CollaborationStore } from './store'
import type { CollaborationWakeQueue } from './wake-queue'

/**
 * Continuing a session in a new one (docs/features/session-continuation.md):
 * the new session takes over the old one's mailbox channels and wakes. Hosts
 * call {@link continueCollaboration} in the same synchronous stretch that
 * creates the new session, so nothing can wake the old one in between.
 */

/** What the host knows about the session being continued; null when it no longer exists. */
export interface ContinuedSessionState {
  /** Running a turn or background work, or waiting on the user. */
  busy: boolean
}

export function assertContinuable(
  store: CollaborationStore,
  wakes: CollaborationWakeQueue,
  from: string,
  state: ContinuedSessionState | null,
): void {
  if (!state) throw new CollaborationError(`Session ${from} no longer exists`, 'not_found')
  const successor = store.successorOf(from)
  if (successor) throw new CollaborationError(`Session ${from} was already continued in ${successor}`, 'failed_precondition')
  if (state.busy || wakes.hasInFlight(from)) {
    throw new CollaborationError(`Session ${from} is working; continue it once it is idle`, 'failed_precondition')
  }
}

/** Check, record the continuation, and move channels and wakes; returns the moved grants. */
export function continueCollaboration(
  store: CollaborationStore,
  wakes: CollaborationWakeQueue,
  from: string,
  to: string,
  state: ContinuedSessionState | null,
): CollaborationGrantRow[] {
  return store.transaction(() => {
    assertContinuable(store, wakes, from, state)
    const moved = store.continueSession(from, to)
    wakes.migrate(from, to)
    return moved
  })
}
