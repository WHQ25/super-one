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

/**
 * True when the session has no conversation on any host yet.
 *
 * Lives here rather than in `draft-promote` so a component can ask "has this
 * conversation started?" without dragging the whole draft pipeline — and the
 * stores it imports — into its module graph.
 */
export function isUnsentSession(session: PerSessionState | undefined): boolean {
  return !!session && session.messages.length === 0 && !_isLiveSession(session)
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
