import { unwrapIpcInvokeError } from '@superone/shared/ipc-error'
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
    // The origin of an old draft is often not a session anymore. Electron's
    // invoke wrapper keeps the message and drops `code`, so match both.
    if (absentOriginSession(error)) return false
    throw error
  }
}

function absentOriginSession(error: unknown): boolean {
  const code = (error as { code?: string }).code
  if (code === 'not_found' || code === 'unsupported') return true
  const message = unwrapIpcInvokeError(error instanceof Error ? error.message : String(error))
  return message === 'session not found' || message.startsWith('Unsupported session operation')
}
