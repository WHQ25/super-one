/**
 * Remote session resync.
 *
 * Main follows every open remote session through the node's pushed stream and
 * resumes it across dropped connections. When that is not enough — the events
 * missed were committed away, the node restarted, or following stopped with an
 * explicit disconnect — main asks for the session to be read again: hydrate
 * from the node (which follows it again from the snapshot's version) and
 * prefer the node's state over what memory froze.
 */
import {
  hydrateRemoteSessionWithCatalog,
  mergeRemoteHydrateWithCurrent,
} from '@/lib/remote-session-ops'
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
  const { hydrated, snap } = await hydrateRemoteSessionWithCatalog(projectPath, sessionId, previous)
  // Renderer-only draft id — the node has never seen it; leave local state alone.
  if (!snap?.sessionId) return

  set((s) => {
    const project = s.projectSessions[projectPath]
    if (!project?._sessions[sessionId]) return {}
    const applied = mergeRemoteHydrateWithCurrent(project._sessions[sessionId], hydrated, {
      preferNodeState: true,
    })
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
