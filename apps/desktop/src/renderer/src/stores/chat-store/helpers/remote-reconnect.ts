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
import type { ChatStore, PerSessionState } from '../types'
import type { ChatStoreSet } from './lifecycle'

/** Patch one session this window holds. `patch` returning null leaves the store alone. */
export function patchRemoteSession(
  projectPath: string,
  sessionId: string,
  patch: (current: PerSessionState) => PerSessionState | null,
  set: ChatStoreSet,
): void {
  set((s) => {
    const project = s.projectSessions[projectPath]
    const current = project?._sessions[sessionId]
    const next = current ? patch(current) : null
    if (!project || !next) return {}
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: { ...project, _sessions: { ...project._sessions, [sessionId]: next } },
      },
    }
  })
}

/** A window read in flight for the chrome: a resync, or a page of history. */
export function setTranscriptFlag(
  projectPath: string,
  sessionId: string,
  flag: 'transcriptResyncing' | 'transcriptPaging',
  on: boolean,
  set: ChatStoreSet,
): void {
  patchRemoteSession(projectPath, sessionId, (current) => current[flag] === on ? null : { ...current, [flag]: on }, set)
}

export async function resyncRemoteSession(
  projectPath: string,
  sessionId: string,
  set: ChatStoreSet,
  get: () => ChatStore,
): Promise<void> {
  const previous = get().projectSessions[projectPath]?._sessions[sessionId]
  // Only sessions this window holds; another window reads its own.
  if (!previous) return
  setTranscriptFlag(projectPath, sessionId, 'transcriptResyncing', true, set)
  try {
    const { hydrated, snap } = await hydrateRemoteSession(projectPath, sessionId, previous)
    // Renderer-only draft id — the node has never seen it; leave local state alone.
    if (!snap?.sessionId) {
      setTranscriptFlag(projectPath, sessionId, 'transcriptResyncing', false, set)
      return
    }
    patchRemoteSession(projectPath, sessionId, (current) => keepRendererOwnedState(current, hydrated), set)
  } catch (error) {
    setTranscriptFlag(projectPath, sessionId, 'transcriptResyncing', false, set)
    throw error
  }
}
