import { summarizeSessionActivity, type SessionActivity } from '@superone/shared/session-activity'
import type { Session } from '../session/types'

/**
 * The one sidebar summary of a live session, for the pushed `session_activity`
 * and the `list_session_activity` snapshot alike — two builders used to read
 * status two different ways, and a phone's row depended on which one it heard last.
 */
export function liveSessionActivity(session: Session): SessionActivity {
  return summarizeSessionActivity({
    ...session.snapshot,
    status: session.activityStatus(),
    seenCompletedMessageId: session.seenCompletedMessageId,
    realtimeActive: session.realtimeActive,
  }, session.getPendingInteractions())
}
