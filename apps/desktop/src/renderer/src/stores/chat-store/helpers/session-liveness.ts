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
 * Side chats already forked a host conversation even when their visible
 * transcript is empty; their temporary composer must never become a draft.
 *
 * Lives here rather than in `draft-promote` so a component can ask "has this
 * conversation started?" without dragging the whole draft pipeline — and the
 * stores it imports — into its module graph.
 */
export function isUnsentSession(session: PerSessionState | undefined): boolean {
  return !!session && !session._sideChatParentId && session.messages.length === 0 && !_isLiveSession(session)
}

/**
 * The directory hint sent with a prewarm or send. A chosen worktree always goes;
 * an unsent, hydrated session also sends its own cwd so a cleared selection moves
 * a prewarmed runtime back. A started or still-loading session sends none: its
 * host owns the directory, and a stub's placeholder cwd must not move it.
 */
export function sessionDirectoryHint(session: PerSessionState, fallback?: string): string | undefined {
  if (session._worktreePath) return session._worktreePath
  return isUnsentSession(session) && session._historyHydrated ? (session.cwd || fallback) : undefined
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
