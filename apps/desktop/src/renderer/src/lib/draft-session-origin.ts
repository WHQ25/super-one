import { isUnsentSession } from '@/stores/chat-store/helpers/session-liveness'
import type { PerSessionState } from '@/stores/chat-store/types'

/** Keep the draft attached to the session that owns an armed scheduled send. */
export async function shouldReuseDraftOriginSessionId(
  originSessionId: string | null | undefined,
  existing: PerSessionState | undefined,
): Promise<boolean> {
  if (!originSessionId) return false
  if (isUnsentSession(existing)) return true
  // Drafts and the sidebar schedule list load independently on startup. Query
  // main here so a click before the list loads cannot orphan the queued send.
  return !!(await window.app.getScheduledSend(originSessionId))?.armed
}
