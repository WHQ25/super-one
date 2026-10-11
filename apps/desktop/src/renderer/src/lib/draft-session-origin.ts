import { callSession } from './session-client'
import { isUnsentSession } from '@/stores/chat-store/helpers/session-liveness'
import type { PerSessionState } from '@/stores/chat-store/types'

/** Keep the draft attached to the session that owns an armed scheduled send. */
export async function shouldReuseDraftOriginSessionId(
  originSessionId: string | null | undefined,
  existing: PerSessionState | undefined,
  projectPath: string,
): Promise<boolean> {
  if (!originSessionId) return false
  if (isUnsentSession(existing)) return true
  // Drafts and the sidebar schedule list load independently on startup. Query
  // main here so a click before the list loads cannot orphan the queued send.
  try {
    return !!(await callSession(projectPath, originSessionId, 'session.scheduledSend.get', {}))?.armed
  } catch (error) {
    if (['unsupported', 'not_found'].includes((error as { code?: string }).code ?? '')) return false
    throw error
  }
}
