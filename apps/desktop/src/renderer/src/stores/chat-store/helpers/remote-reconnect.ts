/**
 * Remote-node reconnect recovery.
 *
 * A dropped connection aborts the main-process event drains and clears their
 * cursors, so re-owning a drain alone resumes from the *current* log head —
 * everything the node appended while offline is skipped. Re-hydrating from
 * `session.get` + `session.messages.list` first closes that gap, and hands the
 * fresh node snapshot to the drain decision so a turn that started (or a
 * permission that was raised) while offline is not missed either.
 */
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import {
  hydrateRemoteSessionWithCatalog,
  mergeRemoteHydrateWithCurrent,
  resumeRemoteSessionIfLive,
} from '@/lib/remote-session-ops'
import type { ChatStore, PerSessionState } from '../types'
import { _isLiveSession, type ChatStoreSet } from './lifecycle'

/**
 * Sessions worth a round-trip on reconnect: the visible tab (the user is
 * looking at it) plus anything memory still believes is live. Deliberately not
 * every cached session — that would fan out to one `session.get` per history
 * row on every reconnect.
 */
function reconnectTargets(project: {
  _activeSessionId: string | null
  _sessions: Record<string, PerSessionState>
}): string[] {
  const targets = new Set<string>()
  if (project._activeSessionId && project._sessions[project._activeSessionId]) {
    targets.add(project._activeSessionId)
  }
  for (const [sessionId, session] of Object.entries(project._sessions)) {
    if (_isLiveSession(session)) targets.add(sessionId)
  }
  return [...targets]
}

async function rehydrateOne(
  projectPath: string,
  sessionId: string,
  set: ChatStoreSet,
  get: () => ChatStore,
): Promise<void> {
  const previous = get().projectSessions[projectPath]?._sessions[sessionId] ?? null
  const { hydrated, snap } = await hydrateRemoteSessionWithCatalog(
    projectPath,
    sessionId,
    previous,
  )
  // Renderer-only draft id — the node has never seen it; leave local state alone.
  if (!snap?.sessionId) return

  let applied = hydrated
  set((s) => {
    const project = s.projectSessions[projectPath]
    if (!project?._sessions[sessionId]) return {}
    applied = mergeRemoteHydrateWithCurrent(project._sessions[sessionId], hydrated, {
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

  resumeRemoteSessionIfLive(projectPath, sessionId, applied, snap)
}

/**
 * Re-sync every remote session of `connectionId` after the environment comes
 * back online. Failures are per-session — one dead session must not stop the
 * others from recovering.
 */
export async function rehydrateRemoteSessionsForConnection(
  connectionId: string,
  set: ChatStoreSet,
  get: () => ChatStore,
): Promise<void> {
  const tasks: Array<Promise<void>> = []

  for (const [projectPath, project] of Object.entries(get().projectSessions)) {
    const remote = parseRemoteProjectKey(projectPath)
    if (!remote || remote.connectionId !== connectionId) continue
    for (const sessionId of reconnectTargets(project)) {
      tasks.push(
        rehydrateOne(projectPath, sessionId, set, get).catch((err) => {
          console.warn('[chat] remote reconnect rehydrate failed:', sessionId, err)
        }),
      )
    }
  }

  await Promise.all(tasks)
}
