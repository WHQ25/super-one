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

/**
 * How many session groups a project shows before "Show more", and how many each
 * reveal adds — the desktop sidebar's `INITIAL_EXPAND_LEVEL` / `EXPAND_STEP`.
 *
 * Deliberately unrelated to `SESSION_PAGE_SIZE`: reveal is a display step, the
 * page is a network one. Over a relay, one 30-row request covering five reveals
 * beats five requests, so the two must not be collapsed into a single number.
 */
export const SESSION_REVEAL_STEP = 6

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
  /** Groups to render before "Show more"; unbounded when omitted. */
  groupLimit?: number,
): SessionListItem[] {
  const items: SessionListItem[] = []
  for (const { parent, children } of visibleSessionGroups(groupSessionRows(rows), groupLimit, activeSessionId)) {
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

/**
 * The first `limit` groups, plus the group holding the session the user is in.
 * Desktop's rule: the current session must stay reachable in the list, and it
 * keeps its natural position rather than being promoted, so switching sessions
 * never reshuffles the list under the finger.
 */
export function visibleSessionGroups(
  groups: SessionListGroup[],
  limit?: number,
  activeSessionId?: string | null,
): SessionListGroup[] {
  if (limit == null || groups.length <= limit) return groups
  const visible = groups.slice(0, limit)
  if (!activeSessionId || visible.some((group) => holdsSession(group, activeSessionId))) return visible
  const active = groups.find((group) => holdsSession(group, activeSessionId))
  return active ? [...visible, active] : visible
}

const holdsSession = (group: SessionListGroup, sessionId: string) =>
  group.parent.sessionId === sessionId || group.children.some((child) => child.sessionId === sessionId)

/**
 * Project paths whose session list the host just reported as changed. Reading
 * the raw batch rather than a typed event: this runs before the batch reaches
 * `ChatRuntime`, which is the only way the drawer stays current while no
 * session is open at all.
 */
export function sessionListInvalidations(events: unknown[]): string[] {
  const paths: string[] = []
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const frame = event as { type?: unknown; projectPath?: unknown }
    if (frame.type !== 'session_list_changed' || typeof frame.projectPath !== 'string') continue
    if (!paths.includes(frame.projectPath)) paths.push(frame.projectPath)
  }
  return paths
}
