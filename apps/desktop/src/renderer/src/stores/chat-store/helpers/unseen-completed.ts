import { createDefaultProjectState } from '../defaults'
import type { ChatStore } from '../types'

/**
 * Store patch that drops `sessionId` from a project's unseen completions, or
 * `{}` when there is nothing to drop. One shape for every "the user has now
 * seen it" path: opening the session here, the panel expanding, and the host's
 * `session_seen` receipt for a read that happened on another client.
 */
export function clearUnseenCompleted(
  state: Pick<ChatStore, 'projectSessions'>,
  projectPath: string,
  sessionId: string,
): Partial<ChatStore> {
  const project = state.projectSessions[projectPath]
  if (!project?.unseenCompletedSessions.has(sessionId)) return {}
  const next = new Set(project.unseenCompletedSessions)
  next.delete(sessionId)
  return {
    projectSessions: {
      ...state.projectSessions,
      [projectPath]: { ...project, unseenCompletedSessions: next },
    },
  }
}

/**
 * Cold sidebar lists carry `unread` on the row. Union those ids into the
 * in-memory set. Never removes: a list fetched before a mark-as-read landed
 * must not put the dot back, and the open session is left to `switchSession`.
 */
export function noteListedUnread(
  state: Pick<ChatStore, 'projectSessions'>,
  entries: ReadonlyArray<{ folderPath: string; sessionId: string }>,
): Partial<ChatStore> {
  if (!entries.length) return {}
  const byFolder = new Map<string, string[]>()
  for (const entry of entries) {
    const list = byFolder.get(entry.folderPath)
    if (list) list.push(entry.sessionId)
    else byFolder.set(entry.folderPath, [entry.sessionId])
  }
  let projectSessions = state.projectSessions
  let changed = false
  for (const [folderPath, ids] of byFolder) {
    const existing = projectSessions[folderPath]
    const active = existing?._activeSessionId
    const incoming = ids.filter((id) => id !== active && !existing?.unseenCompletedSessions.has(id))
    if (!incoming.length) continue
    const project = existing ?? createDefaultProjectState()
    const next = new Set(project.unseenCompletedSessions)
    for (const id of incoming) next.add(id)
    changed = true
    projectSessions = {
      ...projectSessions,
      [folderPath]: { ...project, unseenCompletedSessions: next },
    }
  }
  return changed ? { projectSessions } : {}
}

/** The sidebar's read toggle. Creates the project bucket when marking a row unread before any chat state exists. */
export function setUnseenCompleted(
  state: Pick<ChatStore, 'projectSessions'>,
  projectPath: string,
  sessionId: string,
  unseen: boolean,
): Partial<ChatStore> {
  const existing = state.projectSessions[projectPath]
  const project = existing ?? (unseen ? createDefaultProjectState() : null)
  if (!project) return {}
  const has = project.unseenCompletedSessions.has(sessionId)
  if (has === unseen && existing) return {}
  const next = new Set(project.unseenCompletedSessions)
  if (unseen) next.add(sessionId)
  else next.delete(sessionId)
  return {
    projectSessions: {
      ...state.projectSessions,
      [projectPath]: { ...project, unseenCompletedSessions: next },
    },
  }
}
