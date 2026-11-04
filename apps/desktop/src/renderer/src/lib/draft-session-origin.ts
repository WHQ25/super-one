import { callSession, isAbsentHostSessionError } from './session-client'
import { isUnsentSession } from '@/stores/chat-store/helpers/session-liveness'
import type { PerSessionState } from '@/stores/chat-store/types'

export async function shouldReuseDraftOriginSessionId(
  originSessionId: string | null | undefined,
  existing: PerSessionState | undefined,
  projectPath: string,
): Promise<boolean> {
  if (!originSessionId) return false
  if (isUnsentSession(existing)) return true
  try {
    return !!(await callSession(projectPath, originSessionId, 'session.scheduledSend.get', {}))?.armed
  } catch (error) {
    if (isAbsentHostSessionError(error)) return false
    throw error
  }
}
