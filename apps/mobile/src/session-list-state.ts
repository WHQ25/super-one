import type { HarnessId } from '@superone/shared/agent-types'
import { sessionIsLive } from './session-activity-state'

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
  isUnseen?: boolean
  pendingCount?: number
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
 * Mirrors the desktop sidebar's `groupSidebarSessions`. A child whose parent is
 * outside the loaded window stays a root, so paging never drops a session.
 *
 * Pinning does not reorder here, matching desktop: a pin surfaces the session in
 * the drawer's cross-project Pinned section, and an expanded project keeps the
 * host's recency order so expanding never reshuffles rows under the finger.
 */
export function groupSessionRows(rows: SessionListRow[]): SessionListGroup[] {
  const ids = new Set(rows.map((row) => row.sessionId))
  const children = new Map<string, SessionListRow[]>()
  for (const row of rows) {
    if (!row.parentSessionId || !ids.has(row.parentSessionId)) continue
    children.set(row.parentSessionId, [...(children.get(row.parentSessionId) ?? []), row])
  }
  return rows
    .filter((row) => !row.parentSessionId || !ids.has(row.parentSessionId))
    .map((parent) => ({ parent, children: children.get(parent.sessionId) ?? [] }))
}


/**
 * Flattens groups for a flat list. Collapsed groups still show the session the
 * user is currently in, plus live / unseen / pending children.
 */
export function flattenSessionGroups(
  rows: SessionListRow[],
  expandedIds: ReadonlySet<string>,
  activeSessionId?: string | null,
  /**
   * Groups to render before "Show more". `0` is a collapsed project: only
   * live, unseen, pending, and the active session stay visible, matching
   * desktop. Unbounded when omitted.
   */
  groupLimit?: number,
): SessionListItem[] {
  const items: SessionListItem[] = []
  for (const { parent, children } of visibleSessionGroups(groupSessionRows(rows), groupLimit, activeSessionId)) {
    const hasChildren = children.length > 0
    const collapsed = hasChildren && !expandedIds.has(parent.sessionId)
    items.push({ session: parent, child: false, hasChildren, collapsed })
    const visible = collapsed
      ? children.filter((child) => child.sessionId === activeSessionId || sessionIsLive(child))
      : children
    for (const child of visible) {
      items.push({ session: child, child: true, hasChildren: false, collapsed: false })
    }
  }
  return items
}

const groupIsLive = (group: SessionListGroup) =>
  sessionIsLive(group.parent) || group.children.some(sessionIsLive)

/**
 * Desktop partitions first: live, unseen, and pending work stays at the top of
 * the project, and a collapsed project still shows those groups. The session
 * the user is in is appended, not promoted, so switching never reshuffles the
 * list.
 */
export function partitionSessionGroups(groups: SessionListGroup[]): {
  attention: SessionListGroup[]
  normal: SessionListGroup[]
} {
  const attention: SessionListGroup[] = []
  const normal: SessionListGroup[] = []
  for (const group of groups) {
    if (groupIsLive(group)) attention.push(group)
    else normal.push(group)
  }
  return { attention, normal }
}

/**
 * The first `limit` groups after attention, plus the group holding the session
 * the user is in. `limit === 0` is a collapsed project.
 */
export function visibleSessionGroups(
  groups: SessionListGroup[],
  limit?: number,
  activeSessionId?: string | null,
): SessionListGroup[] {
  const { attention, normal } = partitionSessionGroups(groups)
  const visible = limit === 0
    ? [...attention]
    : limit == null
      ? [...attention, ...normal]
      : [...attention, ...normal.slice(0, Math.max(0, limit - attention.length))]
  return appendActiveGroup(visible, groups, activeSessionId)
}

function appendActiveGroup(
  visible: SessionListGroup[],
  groups: SessionListGroup[],
  activeSessionId?: string | null,
): SessionListGroup[] {
  if (!activeSessionId) return visible
  const shown = new Set(visible.map((group) => group.parent.sessionId))
  return [...visible, ...groups.filter((group) => !shown.has(group.parent.sessionId) && holdsSession(group, activeSessionId))]
}

const holdsSession = (group: SessionListGroup, sessionId: string) =>
  group.parent.sessionId === sessionId || group.children.some((child) => child.sessionId === sessionId)

/**
 * Overlay live activity onto listed rows, and insert a live/unseen/pending
 * session the host has not paged in yet so the sidebar can still name it.
 */
export function mergeActivityIntoRows(
  rows: SessionListRow[],
  activity: Readonly<Record<string, {
    sessionId: string
    projectPath: string
    status: string
    provider?: SessionListRow['provider']
    acpAgentId?: string | null
    title?: string | null
    pendingCount: number
    isUnseen?: boolean
  }>>,
  projectPath?: string | null,
): SessionListRow[] {
  const merged = rows.map((row) => {
    const extra = activity[row.sessionId]
    if (!extra) return row
    return {
      ...row,
      pendingCount: extra.pendingCount,
      isUnseen: extra.isUnseen,
      status: extra.status,
      ...(extra.title ? { title: extra.title } : {}),
      ...(extra.provider ? { provider: extra.provider } : {}),
      ...(extra.acpAgentId !== undefined ? { acpAgentId: extra.acpAgentId } : {}),
    }
  })
  const known = new Set(merged.map((row) => row.sessionId))
  const extras: SessionListRow[] = []
  for (const session of Object.values(activity)) {
    if (projectPath && session.projectPath !== projectPath) continue
    if (known.has(session.sessionId)) continue
    if (!sessionIsLive(session)) continue
    extras.push({
      sessionId: session.sessionId,
      title: session.title || '',
      provider: session.provider,
      acpAgentId: session.acpAgentId,
      pendingCount: session.pendingCount,
      isUnseen: session.isUnseen,
      status: session.status,
      projectPath: session.projectPath,
    })
  }
  return extras.length ? [...extras, ...merged] : merged
}

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
