import type { SessionControlHolder } from '@superone/shared/environment'
import type { ChatStore, PerSessionState } from '../types'
import { updateProjectState } from './store-helpers'

/**
 * Another computer drives this session: one that started it here and still
 * holds control, the one it runs on after taking it back from us, or another
 * device that holds it now.
 */
export function isControlledElsewhere(session: Pick<PerSessionState, 'remoteController' | 'remoteControlReleased' | 'controlHolder'> | undefined): boolean {
  return !!(session?.remoteController && !session.remoteController.released) || !!session?.remoteControlReleased || !!session?.controlHolder
}

/** This computer's windows share one composer, so only a phone or controller desktop holds a session elsewhere. */
export function externalHolder(holder: SessionControlHolder | null | undefined): SessionControlHolder | null {
  return holder && holder.kind !== 'window' ? holder : null
}

/** A `session_control_holder` for a session on another computer: who drives it there now, if not us. */
export function applyControlHolder(state: ChatStore, projectPath: string, sessionId: string, holder: SessionControlHolder | null): Partial<ChatStore> {
  const session = state.projectSessions[projectPath]?._sessions[sessionId]
  if (!session) return {}
  return updateProjectState(state, projectPath, (project) => ({
    _sessions: { ...project._sessions, [sessionId]: { ...session, controlHolder: holder } },
  }))
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
