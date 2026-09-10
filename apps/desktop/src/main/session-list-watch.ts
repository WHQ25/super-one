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
