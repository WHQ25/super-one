/**
 * The one way the chat reaches a session's host. A project key names the
 * environment — a plain path for this desktop (`local`), `remote:<id>:<path>`
 * for a paired node — and every operation goes through `window.environment`,
 * so callers never branch on where a session runs.
 */
import type {
  SessionCallMethod,
  SessionCallMethods,
  SessionForkRequestInput,
  SessionPermissionAnswer,
  SessionPlanAnswer,
  SessionQuestionAnswer,
  SessionSettingsPatch,
} from '@superone/shared/environment/session-requests'
import type { PerSessionState, PersistedSessionState } from '@/stores/chat-store/types'
import { withCodexContents } from '@superone/shared/codex-content'
import { parseRemoteProjectKey } from './remote-project-key'
import { connectionIdForProjectKey } from './session-list-ops'

/** A project key's folder as its host names it. */
export function hostPathForProjectKey(projectKey: string): string {
  return parseRemoteProjectKey(projectKey)?.path ?? projectKey
}

/**
 * Whether the session's host takes this desktop's own choices: the session id
 * a draft keeps, queued turns, the harness pickers (Codex thread and tier,
 * OpenCode agent, Cursor parameters), widget answers, and the desktop
 * settings a node takes per turn. This desktop's host does; a node refuses
 * them (`unsupported`).
 */
export function hostTakesDesktopChoices(projectKey: string): boolean {
  return connectionIdForProjectKey(projectKey) === 'local'
}

export function renameSession(projectKey: string, sessionId: string, title: string) {
  return window.environment.renameSession(connectionIdForProjectKey(projectKey), sessionId, title)
}

export function setSessionFlags(projectKey: string, sessionId: string, flags: { isPinned?: boolean; isHidden?: boolean }) {
  return window.environment.setSessionUiFlags(connectionIdForProjectKey(projectKey), sessionId, flags)
}

export function removeSession(projectKey: string, sessionId: string) {
  return window.environment.removeSession(connectionIdForProjectKey(projectKey), sessionId)
}

export function forkSession(projectKey: string, input: SessionForkRequestInput) {
  return window.environment.forkSession(connectionIdForProjectKey(projectKey), input)
}

/**
 * A session's stored settings with its whole transcript, as the chat restores
 * a cold session. Null when the host has no such session (a renderer draft) or
 * keeps no stored state for it.
 */
export async function loadStoredSession(projectKey: string, sessionId: string): Promise<PersistedSessionState | null> {
  const connectionId = connectionIdForProjectKey(projectKey)
  if (!await window.environment.getSession(connectionId, sessionId)) return null
  const loaded = await window.environment.openRemoteSession(connectionId, { sessionId, projectPath: projectKey, full: true })
  const stored = (loaded.state as { stored?: Omit<PersistedSessionState, 'messages'> }).stored
  return stored ? { ...stored, messages: withCodexContents(loaded.messages) } : null
}

export function respondPermission(projectKey: string, input: SessionPermissionAnswer) {
  return window.environment.respondSessionPermission(connectionIdForProjectKey(projectKey), input)
}

export function respondQuestion(projectKey: string, input: SessionQuestionAnswer) {
  return window.environment.respondSessionQuestion(connectionIdForProjectKey(projectKey), input)
}

export function respondPlan(projectKey: string, input: SessionPlanAnswer) {
  return window.environment.respondSessionPlan(connectionIdForProjectKey(projectKey), input)
}

export function interruptSession(projectKey: string, sessionId: string) {
  return window.environment.interruptSession(connectionIdForProjectKey(projectKey), sessionId)
}

/**
 * Apply a settings change on the host running the session, answering with its
 * record. A session the host has not created yet (a renderer draft) keeps the
 * change in the store, and its first send carries it: the answer is null.
 */
export async function patchSessionSettings(
  projectKey: string,
  sessionId: string,
  session: Pick<PerSessionState, 'hostSessionOwned'>,
  patch: SessionSettingsPatch,
): Promise<{ sandboxMode?: string | null } | null> {
  if (!session.hostSessionOwned) return null
  return await window.environment.patchSessionSettings(connectionIdForProjectKey(projectKey), sessionId, patch) as { sandboxMode?: string | null }
}

/** `patchSessionSettings` for a picker that already wrote the store; a failure is logged. */
export function pushSettings(
  projectKey: string,
  sessionId: string | null,
  session: Pick<PerSessionState, 'hostSessionOwned'>,
  patch: SessionSettingsPatch,
): void {
  if (!sessionId) return
  void patchSessionSettings(projectKey, sessionId, session, patch)
    .catch((error) => console.warn('[chat] session settings change failed:', error))
}

/** A session operation outside the shared node family (queue, recap, goal). */
export function callSession<M extends SessionCallMethod>(
  projectKey: string,
  sessionId: string,
  method: M,
  input: SessionCallMethods[M]['input'],
): Promise<SessionCallMethods[M]['result']> {
  return window.environment.callSession(connectionIdForProjectKey(projectKey), sessionId, method, input)
}

/** A draft may have no runtime, and a host without reset starts its next draft on first send. */
export async function resetHostSession(projectKey: string, sessionId: string, newSessionId?: string) {
  try {
    return await callSession(projectKey, sessionId, 'session.reset', newSessionId ? { newSessionId } : {})
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'not_found' || code === 'unsupported') return null
    throw error
  }
}
