/**
 * The one way the chat reaches a session's host. A project key names the
 * environment — a plain path for this desktop (`local`), `remote:<id>:<path>`
 * for a paired node — and every operation goes through `window.environment`,
 * so callers never branch on where a session runs.
 */
import type { SessionForkRequestInput } from '@superone/shared/environment/session-requests'
import type { PersistedSessionState } from '@/stores/chat-store/types'
import { connectionIdForProjectKey } from './session-list-ops'

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
  return stored ? { ...stored, messages: loaded.messages } : null
}
