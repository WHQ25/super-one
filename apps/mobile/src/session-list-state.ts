import type { HarnessId } from '@superone/shared/agent-types'

/** One row of a remote project's session list, as `list_sessions` returns it. */
export type SessionListRow = {
  sessionId: string
  title: string
  lastActiveAt?: string
  provider?: HarnessId
  acpAgentId?: string | null
  messageCount?: number
  gitBranch?: string
  selectedModel?: string | null
  status?: string
  tags?: string[]
  /** Collaboration parent (`session_collab_start` spawn); groups the row on desktop. */
  parentSessionId?: string | null
  isPinned?: boolean
  /** Set only by the cross-project lists (pinned, search), which span projects. */
  projectPath?: string
  projectName?: string
}

export type SessionListGroup = { parent: SessionListRow; children: SessionListRow[] }

/** A parent row, or one of its collaboration children, in render order. */
export type SessionListItem = {
  session: SessionListRow
  /** Rendered indented under its parent. */
  child: boolean
  hasChildren: boolean
  collapsed: boolean
}

/**
 * Mirrors the desktop sidebar's `groupSidebarSessions`, then promotes pinned
 * groups. A child whose parent is outside the loaded window stays a root, so
 * paging never drops a session; a pinned child stays under its parent, because
 * lifting it out would hide who spawned it.
 *
 * Promotion only orders what is already loaded. The desktop has no equivalent:
 * it keeps a cross-project pinned section and never reorders a project's list.
 */
export function groupSessionRows(rows: SessionListRow[]): SessionListGroup[] {
  const ids = new Set(rows.map((row) => row.sessionId))
  const children = new Map<string, SessionListRow[]>()
  for (const row of rows) {
    if (!row.parentSessionId || !ids.has(row.parentSessionId)) continue
    children.set(row.parentSessionId, [...(children.get(row.parentSessionId) ?? []), row])
  }
  const groups = rows
    .filter((row) => !row.parentSessionId || !ids.has(row.parentSessionId))
    .map((parent) => ({ parent, children: children.get(parent.sessionId) ?? [] }))
  // Array.prototype.sort is stable, so unpinned groups keep the host's order.
  return groups.sort((a, b) => Number(!!b.parent.isPinned) - Number(!!a.parent.isPinned))
}


/**
 * Flattens groups for a flat list. Collapsed groups still show the session the
 * user is currently in — desktop's `isVisibleWhenCollapsed`, minus the pending
 * states the remote row payload does not carry.
 */
export function flattenSessionGroups(
  rows: SessionListRow[],
  expandedIds: ReadonlySet<string>,
  activeSessionId?: string | null,
): SessionListItem[] {
  const items: SessionListItem[] = []
  for (const { parent, children } of groupSessionRows(rows)) {
    const hasChildren = children.length > 0
    const collapsed = hasChildren && !expandedIds.has(parent.sessionId)
    items.push({ session: parent, child: false, hasChildren, collapsed })
    const visible = collapsed
      ? children.filter((child) => child.sessionId === activeSessionId)
      : children
    for (const child of visible) {
      items.push({ session: child, child: true, hasChildren: false, collapsed: false })
    }
  }
  return items
}
