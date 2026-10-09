import type { ChatStore, PerSessionState } from '../types'
import { updateProjectState } from './store-helpers'

/**
 * Another computer drives this session: one that started it here and still
 * holds control, or the one it runs on after taking it back from us.
 */
export function isControlledElsewhere(session: Pick<PerSessionState, 'remoteController' | 'remoteControlReleased'> | undefined): boolean {
  return !!(session?.remoteController && !session.remoteController.released) || !!session?.remoteControlReleased
}

/**
 * A `remote_control_changed` for one session. On the computer the session runs
 * on it opens (released) or closes its composer; on the controller it closes
 * (released) or reopens the composer there.
 */
export function applyRemoteControlChange(state: ChatStore, projectPath: string, sessionId: string, released: boolean): Partial<ChatStore> {
  const session = state.projectSessions[projectPath]?._sessions[sessionId]
  if (!session) return {}
  const next: PerSessionState = session.remoteController
    ? { ...session, remoteController: { ...session.remoteController, released } }
    : { ...session, remoteControlReleased: released }
  return updateProjectState(state, projectPath, (project) => ({
    _sessions: { ...project._sessions, [sessionId]: next },
  }))
}
