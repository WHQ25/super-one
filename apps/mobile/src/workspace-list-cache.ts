import type { PersistedWorkspace } from './persisted-workspace'
import type { SessionListRow } from './session-list-state'

/** One project's rows as last read, plus the invalidation revision they reflect. */
export type CachedSessionList = {
  rows: SessionListRow[]
  total: number
  /** `revisionOf(path)` at the time of the read; anything newer means stale. */
  revision: number
}

/**
 * Every session list the workspace panel has read over one connection.
 *
 * The drawer unmounts its list on every close (it must leave the tree so
 * nothing sits over the chat), which used to mean every open started from
 * nothing: a spinner on the active project and one `list_sessions` per armed
 * row, plus the Pinned section. This object outlives the panel, so an open
 * paints what was there and costs a request only for a project the host has
 * reported as changed since — the `session_list_changed` signal was already
 * being sent; without a place to remember what it had said, it was answered by
 * re-reading everything anyway.
 *
 * Revisions are per project. A change in one project does not stale another,
 * which the single global counter this replaces could not express. A reconnect
 * stales every list at once: the socket that was down missed every signal.
 *
 * Plain mutable object, not React state: it is read into component state on
 * mount and written back as that state changes. Re-rendering on a bump is the
 * shell's `listRevision` tick, which the consumers take as a prop.
 */
export class WorkspaceListCache {
  private readonly lists = new Map<string, CachedSessionList>()
  private readonly invalidations = new Map<string, number>()
  private everyList = 0
  /** The cross-project Pinned section; any project's change may have moved a row. */
  private pinnedRows: { rows: SessionListRow[]; revision: number } | null = null
  get pinned() { return this.pinnedRows }
  set pinned(value: { rows: SessionListRow[]; revision: number } | null) {
    this.pinnedRows = value
    this.persistence?.set('pinned', value ? { rows: value.rows.slice(0, 30), revision: -1 } : null)
  }
  pinnedRevision = 0
  /** Which project rows stand open — also lost on every drawer unmount otherwise. */
  expandedPaths: ReadonlySet<string> = new Set()

  constructor(readonly persistence?: PersistedWorkspace) {
    const saved = persistence?.get<{ rows?: SessionListRow[] }>('pinned')
    if (Array.isArray(saved?.rows)) this.pinnedRows = { rows: validRows(saved.rows), revision: -1 }
  }

  get(path: string): CachedSessionList | undefined {
    if (!this.lists.has(path)) {
      const cached = this.persistence?.get<CachedSessionList>(`sessions:${path}`)
      if (cached && Array.isArray(cached.rows) && Number.isFinite(cached.total)) this.lists.set(path, { ...cached, rows: validRows(cached.rows), revision: -1 })
    }
    return this.lists.get(path)
  }

  store(path: string, list: CachedSessionList): void {
    this.lists.set(path, list)
    this.persistence?.set(`sessions:${path}`, { ...list, rows: list.rows.slice(0, 30), revision: -1 })
  }

  /** The latest revision a list for `path` could reflect. */
  revisionOf(path: string): number {
    return this.everyList + (this.invalidations.get(path) ?? 0)
  }

  /** The host reported this project's list as changed. */
  invalidate(path: string): void {
    this.invalidations.set(path, (this.invalidations.get(path) ?? 0) + 1)
    this.pinnedRevision++
  }

  /** Nothing held can be trusted — a reconnect, which missed every signal meanwhile. */
  invalidateAll(): void {
    this.everyList++
    this.pinnedRevision++
  }
}

function validRows(rows: SessionListRow[]): SessionListRow[] {
  return rows.filter(row => row && typeof row.sessionId === 'string' && typeof row.title === 'string').slice(0, 30)
}
