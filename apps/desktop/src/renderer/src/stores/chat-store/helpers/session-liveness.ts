/**
 * Pure session-status predicates, kept in a leaf module with no store imports.
 *
 * `lifecycle.ts` re-exports these, but importing them from here lets modules
 * that only need the predicate stay out of the `helpers → app store →
 * chat-store/index` import cycle.
 */

import type { PerSessionState } from '../types'

export function _isBusyStatus(status: PerSessionState['status']): boolean {
  return status === 'streaming' || status === 'background'
}

/** A session with a backend turn, or anything waiting on the user, in flight. */
export function _isLiveSession(session: PerSessionState | undefined): boolean {
  return !!session && (
    _isBusyStatus(session.status)
    || session.pendingPermissions.length > 0
    || !!session.pendingQuestion
    || !!session.pendingPlanApproval
    || !!session.awaitingAssistantReply
  )
}
