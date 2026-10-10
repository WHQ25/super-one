/**
 * Remote session resync.
 *
 * Main follows every open remote session through the node's pushed stream and
 * resumes it across dropped connections. When that is not enough — the events
 * missed were committed away, the node restarted, or following stopped with an
 * explicit disconnect — main asks for the session to be read again: its
 * snapshot replaces what memory froze, and main follows it again from there.
 */
import { hydrateRemoteSession, keepRendererOwnedState } from '@/lib/remote-session-ops'
import type { ChatStore } from '../types'
import type { ChatStoreSet } from './lifecycle'

export async function resyncRemoteSession(
  projectPath: string,
  sessionId: string,
  set: ChatStoreSet,
  get: () => ChatStore,
): Promise<void> {
  const previous = get().projectSessions[projectPath]?._sessions[sessionId]
  // Only sessions this window holds; another window reads its own.
  if (!previous) return
  const { hydrated, snap } = await hydrateRemoteSession(projectPath, sessionId, previous)
  // Renderer-only draft id — the node has never seen it; leave local state alone.
  if (!snap?.sessionId) return

  set((s) => {
    const project = s.projectSessions[projectPath]
    if (!project?._sessions[sessionId]) return {}
    const applied = keepRendererOwnedState(project._sessions[sessionId], hydrated)
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: {
          ...project,
          _sessions: { ...project._sessions, [sessionId]: applied },
        },
      },
    }
  })
}
