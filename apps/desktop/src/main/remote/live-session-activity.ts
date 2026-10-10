import { SESSION_ACTIVITY_EVENTS, summarizeSessionActivity, type SessionActivity } from '@superone/shared/session-activity'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { Session } from '../session/types'

/**
 * The one sidebar summary of a live session, for the pushed `session_activity`
 * and the `list_session_activity` snapshot alike — two builders used to read
 * status two different ways, and a phone's row depended on which one it heard last.
 */
export function liveSessionActivity(session: Session, parentSessionId: string | null): SessionActivity {
  return summarizeSessionActivity({
    ...session.snapshot,
    status: session.activityStatus(),
    seenCompletedMessageId: session.seenCompletedMessageId,
    realtimeActive: session.realtimeActive,
    parentSessionId,
  }, session.getPendingInteractions())
}

/** A session-list notice for the session events that change its sidebar summary. */
export function sessionActivityEvent(session: Session, event: AgentEvent, parentSessionId: string | null): AgentEvent | null {
  if (session.ephemeral || !SESSION_ACTIVITY_EVENTS.has(event.type)) return null
  return { type: 'session_activity', activity: liveSessionActivity(session, parentSessionId),
    ...(event.type === 'status_change' && event.status === 'idle' ? { completed: true } : {}) }
}
