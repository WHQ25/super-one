/**
 * "Some project's session list just changed" — the one signal remote clients
 * re-read their list on.
 *
 * Its own module rather than a corner of `db-sessions`: the writes that change a
 * session list are split across `db-sessions` (rename/pin/hide/delete) and
 * `session/session-repo` (insert/upsert/fork), and `db-sessions` already imports
 * from `session-repo`. Anything shared has to sit below both of them.
 *
 * Registered at the writes rather than at the callers: the same mutations are
 * reached from IPC, the session manager, automations and remote commands, and a
 * notification hung off each of those would be missed by whichever call site is
 * added next.
 */
export type SessionListWatcher = (projectPath: string) => void

const sessionListWatchers = new Set<SessionListWatcher>()

export function watchSessionList(watcher: SessionListWatcher): () => void {
  sessionListWatchers.add(watcher)
  return () => { sessionListWatchers.delete(watcher) }
}

/** No-op for a project that could not be resolved — there is nothing to name. */
export function notifySessionList(projectPath: string | null | undefined): void {
  if (!projectPath) return
  for (const watcher of sessionListWatchers) watcher(projectPath)
}

/**
 * "These sessions no longer exist" — the signal everything that holds
 * per-session state outside the database reclaims on (the sync zone under
 * userData, its transfer jobs). Same reasoning as the list watcher: three
 * entry points delete sessions (one IPC, "delete older", `session_cleanup`),
 * and a cleanup hung off one of them was missed by the other two.
 */
export type SessionDeleteWatcher = (sessionIds: string[]) => void

const sessionDeleteWatchers = new Set<SessionDeleteWatcher>()

export function watchSessionDeletes(watcher: SessionDeleteWatcher): () => void {
  sessionDeleteWatchers.add(watcher)
  return () => { sessionDeleteWatchers.delete(watcher) }
}

export function notifySessionsDeleted(sessionIds: string[]): void {
  if (sessionIds.length === 0) return
  for (const watcher of sessionDeleteWatchers) watcher(sessionIds)
}
