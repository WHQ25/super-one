/**
 * SuperOne MCP session archive tools:
 * session_list / session_search / session_read / session_cleanup
 *
 * Reads SuperOne's unified SQLite transcript (harness-agnostic). Does not resume
 * provider_session_id across harnesses. Tool calls are never embedded in text views.
 */

import { encode as toonEncode } from '@toon-format/toon'
import type { ChatMessage } from '@superone/shared/agent-types'
import { getDb } from '../database'
import {
  deleteSession,
  hideSession,
  loadSessionState,
  sessionBelongsToProject,
} from '../db-sessions'
import log from '../logger'
import { getProjectId } from '../recent-folders'
import { HostConfirmRegistry } from '../session/host-confirm-registry'
import { deriveHarnessId } from '../session/session-repo'
import {
  countTools,
  extractToolIndex,
  findToolDetail,
  formatTextMessages,
  formatToolIndex,
  messageSearchText,
  pageItems,
  type SessionArchiveView,
} from '../session/session-transcript-view'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

// --- Limits ---

export const SESSION_LIST_DEFAULT_LIMIT = 20
export const SESSION_LIST_MAX_LIMIT = 50
export const SESSION_READ_DEFAULT_LIMIT = 20
export const SESSION_READ_MAX_LIMIT = 50
export const SESSION_SEARCH_DEFAULT_LIMIT = 20
export const SESSION_SEARCH_MAX_LIMIT = 50
export const SESSION_CLEANUP_MAX_DELETE = 50
const CLEANUP_CONFIRM_TIMEOUT_MS = 10 * 60_000

// --- Shared helpers ---

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

function toonResult(value: unknown) {
  return toolResult(toonEncode(value))
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.max(1, Math.min(max, Math.floor(raw)))
}

function currentProjectPath(deps: BuiltInSuperoneToolDeps): string | null {
  return deps.sessionHost?.getSession(deps.sessionId)?.projectPath ?? null
}

function requireProject(deps: BuiltInSuperoneToolDeps): { projectPath: string; projectId: string } | { error: ReturnType<typeof toolResult> } {
  const projectPath = currentProjectPath(deps)
  if (!projectPath) {
    return { error: toolResult({ status: 'error', message: 'No project path for the current session.' }, true) }
  }
  const projectId = getProjectId(projectPath)
  if (!projectId) {
    return { error: toolResult({ status: 'error', message: `Project not found for path: ${projectPath}` }, true) }
  }
  return { projectPath, projectId }
}

interface ArchiveSessionRow {
  id: string
  title: string | null
  created_at: string
  last_user_msg_at: string
  is_worktree: number | null
  is_pinned: number | null
  is_hidden: number | null
  git_branch: string | null
  worktree_path: string | null
  is_automation: number | null
  provider_id: string | null
  provider: string | null
  acp_agent_id: string | null
  parent_session_id: string | null
  message_count: number
  /**
   * Approximate transcript payload for ranking only (SQLite LENGTH on TEXT =
   * character length of content_json + metadata_json). Not disk page-file bytes.
   * Null when not computed (default list order skips the subquery).
   */
  size_bytes: number | null
  selected_model: string | null
  total_cost_usd: number | null
  context_tokens: number | null
}

/**
 * Approximate transcript payload for ranking: sum of LENGTH(content_json) +
 * LENGTH(metadata_json) over chat_messages. SQLite LENGTH on TEXT is character
 * length (not UTF-8 bytes / page-file size). Only used when sorting by size_*.
 */
const SESSION_SIZE_BYTES_SQL = `(SELECT COALESCE(SUM(LENGTH(m.content_json) + LENGTH(COALESCE(m.metadata_json, ''))), 0) FROM chat_messages m WHERE m.session_id = s.id)`

/** Sort keys for session_list. Default last_active_desc (newest activity first). */
export const SESSION_LIST_ORDERS = [
  'last_active_desc',
  'last_active_asc',
  'created_desc',
  'created_asc',
  'message_count_desc',
  'message_count_asc',
  'size_desc',
  'size_asc',
] as const

export type SessionListOrder = (typeof SESSION_LIST_ORDERS)[number]
export const SESSION_LIST_DEFAULT_ORDER: SessionListOrder = 'last_active_desc'

/** Non-empty tuple form for Zod `z.enum(...)` and JSON-schema `enum` arrays. */
export const SESSION_LIST_ORDER_ENUM = SESSION_LIST_ORDERS as unknown as [
  SessionListOrder,
  ...SessionListOrder[],
]

const SESSION_LIST_ORDER_SET = new Set<string>(SESSION_LIST_ORDERS)

export function sessionListOrderNeedsSize(order: SessionListOrder): boolean {
  return order === 'size_desc' || order === 'size_asc'
}

/** Whitelisted SQL ORDER BY fragments — never interpolate raw user strings. */
const SESSION_LIST_ORDER_SQL: Record<SessionListOrder, string> = {
  last_active_desc: 'last_user_msg_at DESC, s.id ASC',
  last_active_asc: 'last_user_msg_at ASC, s.id ASC',
  created_desc: 's.created_at DESC, s.id ASC',
  created_asc: 's.created_at ASC, s.id ASC',
  message_count_desc: 'message_count DESC, last_user_msg_at DESC, s.id ASC',
  message_count_asc: 'message_count ASC, last_user_msg_at ASC, s.id ASC',
  size_desc: 'size_bytes DESC, last_user_msg_at DESC, s.id ASC',
  size_asc: 'size_bytes ASC, last_user_msg_at ASC, s.id ASC',
}

export function parseSessionListOrder(raw: unknown): SessionListOrder | null {
  if (raw == null || raw === '') return SESSION_LIST_DEFAULT_ORDER
  if (typeof raw !== 'string') return null
  return SESSION_LIST_ORDER_SET.has(raw) ? (raw as SessionListOrder) : null
}

function listArchiveSessions(
  projectId: string,
  opts: {
    includeHidden?: boolean
    includePinnedOnly?: boolean
    parentOnly?: boolean
    harness?: string
    query?: string
    olderThan?: string
    newerThan?: string
    order?: SessionListOrder
    limit: number
    offset: number
  },
): ArchiveSessionRow[] {
  const db = getDb()
  const where: string[] = ['s.project_id = ?']
  const params: unknown[] = [projectId]

  if (!opts.includeHidden) {
    where.push('COALESCE(s.is_hidden, 0) = 0')
  }
  if (opts.includePinnedOnly) {
    where.push('COALESCE(s.is_pinned, 0) = 1')
  }
  if (opts.parentOnly) {
    where.push('g.parent_session_id IS NULL')
  }
  if (opts.query?.trim()) {
    where.push('LOWER(COALESCE(s.title, \'\')) LIKE ?')
    params.push(`%${opts.query.trim().toLowerCase()}%`)
  }
  if (opts.olderThan) {
    where.push('COALESCE(s.last_user_message_at, s.created_at) < ?')
    params.push(opts.olderThan)
  }
  if (opts.newerThan) {
    where.push('COALESCE(s.last_user_message_at, s.created_at) > ?')
    params.push(opts.newerThan)
  }

  // harness filter applied after map (deriveHarnessId); over-fetch slightly when filtering
  const fetchLimit = opts.harness ? opts.limit + opts.offset + 200 : opts.limit
  const fetchOffset = opts.harness ? 0 : opts.offset
  const order = opts.order ?? SESSION_LIST_DEFAULT_ORDER
  const orderBy = SESSION_LIST_ORDER_SQL[order]
  // Correlated size subquery is relatively expensive — only when sorting by size_*.
  const sizeSelect = sessionListOrderNeedsSize(order)
    ? `${SESSION_SIZE_BYTES_SQL} AS size_bytes`
    : 'NULL AS size_bytes'

  const sql = `
    SELECT s.id, s.title, s.created_at, s.is_worktree, s.is_pinned, s.is_hidden, s.git_branch, s.worktree_path,
           s.is_automation, s.provider_id, s.provider, s.acp_agent_id, s.selected_model,
           s.total_cost_usd, s.context_tokens,
           g.parent_session_id,
           COALESCE(s.last_user_message_at, s.created_at) AS last_user_msg_at,
           (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
           ${sizeSelect}
    FROM sessions s
    LEFT JOIN session_collaboration_grants g ON g.child_session_id = s.id
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `
  params.push(fetchLimit, fetchOffset)
  let rows = db.prepare(sql).all(...params) as ArchiveSessionRow[]

  if (opts.harness) {
    const h = opts.harness.toLowerCase()
    rows = rows.filter((r) => deriveHarnessId(r) === h)
    rows = rows.slice(opts.offset, opts.offset + opts.limit)
  }

  return rows
}

function rowToListEntry(row: ArchiveSessionRow, selfId: string) {
  return {
    id: row.id,
    title: row.title ?? 'Untitled',
    harness: deriveHarnessId(row),
    acpAgentId: row.acp_agent_id ?? null,
    createdAt: row.created_at,
    lastActiveAt: row.last_user_msg_at,
    messageCount: row.message_count ?? 0,
    // Only present when order is size_* (see sessionListOrderNeedsSize). Ranking metric:
    // character length of stored message JSON, not disk page-file bytes.
    ...(row.size_bytes != null ? { sizeBytes: row.size_bytes } : {}),
    pinned: !!row.is_pinned,
    hidden: !!row.is_hidden,
    parentId: row.parent_session_id ?? null,
    branch: row.git_branch ?? null,
    isSelf: row.id === selfId,
  }
}

// --- session_list ---

export interface SessionListArgs {
  query?: string
  harness?: string
  includeHidden?: boolean
  includePinnedOnly?: boolean
  parentOnly?: boolean
  olderThan?: string
  newerThan?: string
  /** Sort key. Default last_active_desc. Use last_active_asc for oldest-first cleanup. */
  order?: SessionListOrder
  limit?: number
  offset?: number
}

export function sessionListHandler(args: SessionListArgs, deps: BuiltInSuperoneToolDeps) {
  const project = requireProject(deps)
  if ('error' in project) return project.error

  const order = parseSessionListOrder(args.order)
  if (order == null) {
    return toolResult({
      status: 'error',
      message: `Invalid order. Use one of: ${SESSION_LIST_ORDERS.join(', ')}`,
    }, true)
  }

  const limit = clampLimit(args.limit, SESSION_LIST_DEFAULT_LIMIT, SESSION_LIST_MAX_LIMIT)
  const offset = typeof args.offset === 'number' && Number.isFinite(args.offset)
    ? Math.max(0, Math.floor(args.offset))
    : 0

  const rows = listArchiveSessions(project.projectId, {
    includeHidden: args.includeHidden === true,
    includePinnedOnly: args.includePinnedOnly === true,
    parentOnly: args.parentOnly === true,
    harness: typeof args.harness === 'string' ? args.harness : undefined,
    query: typeof args.query === 'string' ? args.query : undefined,
    olderThan: typeof args.olderThan === 'string' ? args.olderThan : undefined,
    newerThan: typeof args.newerThan === 'string' ? args.newerThan : undefined,
    order,
    limit,
    offset,
  })

  const sessions = rows.map((r) => rowToListEntry(r, deps.sessionId))
  return toonResult({
    projectPath: project.projectPath,
    order,
    offset,
    limit,
    count: sessions.length,
    sessions,
  })
}

// --- session_search ---

export interface SessionSearchArgs {
  query: string
  harness?: string
  sessionIds?: string[]
  role?: 'user' | 'assistant' | 'any'
  limit?: number
}

export function sessionSearchHandler(args: SessionSearchArgs, deps: BuiltInSuperoneToolDeps) {
  const project = requireProject(deps)
  if ('error' in project) return project.error

  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) {
    return toolResult({ status: 'error', message: 'query is required' }, true)
  }

  const limit = clampLimit(args.limit, SESSION_SEARCH_DEFAULT_LIMIT, SESSION_SEARCH_MAX_LIMIT)
  const role = args.role === 'user' || args.role === 'assistant' ? args.role : 'any'
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const sessionIdFilter = Array.isArray(args.sessionIds)
    ? new Set(args.sessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0))
    : null
  const harnessFilter = typeof args.harness === 'string' ? args.harness.toLowerCase() : null

  const db = getDb()
  // Broad SQL prefilter with first term, then refine in JS for multi-word AND.
  const like = `%${terms[0]}%`
  const rows = db.prepare(`
    SELECT m.id AS message_id, m.session_id, m.role, m.created_at, m.content_json,
           s.title, s.provider_id, s.provider, s.acp_agent_id
    FROM chat_messages m
    JOIN sessions s ON s.id = m.session_id
    WHERE s.project_id = ?
      AND COALESCE(s.is_hidden, 0) = 0
      AND (LOWER(COALESCE(s.title, '')) LIKE ? OR LOWER(m.content_json) LIKE ?)
    ORDER BY m.created_at DESC
    LIMIT 500
  `).all(project.projectId, like, like) as Array<{
    message_id: string
    session_id: string
    role: string
    created_at: string
    content_json: string
    title: string | null
    provider_id: string | null
    provider: string | null
    acp_agent_id: string | null
  }>

  const hits: Array<{
    sessionId: string
    title: string
    harness: string
    messageId: string
    role: string
    createdAt: string
    snippet: string
  }> = []

  for (const row of rows) {
    if (sessionIdFilter && !sessionIdFilter.has(row.session_id)) continue
    if (role !== 'any' && row.role !== role) continue
    const harness = deriveHarnessId(row)
    if (harnessFilter && harness !== harnessFilter) continue

    // Parse content for real text match (avoid matching tool JSON noise when possible).
    let text = ''
    try {
      const parsed = JSON.parse(row.content_json) as { content?: ChatMessage['content'] } | ChatMessage['content']
      const content = Array.isArray(parsed) ? parsed : parsed.content ?? []
      text = messageSearchText({
        id: row.message_id,
        role: row.role as ChatMessage['role'],
        status: 'complete',
        content,
        createdAt: row.created_at,
        providerId: 'unknown',
      })
    } catch {
      text = row.content_json
    }

    const haystack = `${row.title ?? ''}\n${text}`.toLowerCase()
    if (!terms.every((t) => haystack.includes(t))) continue

    // Snippet: locate first term and take a window — this is a search pointer, not content delivery.
    const idx = haystack.indexOf(terms[0])
    const start = Math.max(0, idx - 60)
    const end = Math.min(haystack.length, idx + terms[0].length + 140)
    let snippet = (text || row.title || '').slice(
      Math.max(0, Math.min(text.length, start)),
      Math.min(text.length, end > text.length ? text.length : end),
    )
    if (!snippet) snippet = (row.title ?? '').slice(0, 200)
    if (start > 0) snippet = `…${snippet}`
    if (end < haystack.length) snippet = `${snippet}…`

    hits.push({
      sessionId: row.session_id,
      title: row.title ?? 'Untitled',
      harness,
      messageId: row.message_id,
      role: row.role,
      createdAt: row.created_at,
      snippet: snippet.replace(/\s+/g, ' ').trim(),
    })
    if (hits.length >= limit) break
  }

  return toonResult({
    projectPath: project.projectPath,
    query,
    count: hits.length,
    hits,
  })
}

// --- session_read ---

export interface SessionReadArgs {
  sessionId: string
  view?: SessionArchiveView
  messageId?: string
  around?: number
  cursor?: number | null
  limit?: number
  includeThinking?: boolean
  toolUseId?: string
}

function loadMessages(sessionId: string): ChatMessage[] {
  const state = loadSessionState(sessionId)
  return state?.messages ?? []
}

function assertReadable(deps: BuiltInSuperoneToolDeps, sessionId: string): { ok: true; projectPath: string } | { ok: false; error: ReturnType<typeof toolResult> } {
  const project = requireProject(deps)
  if ('error' in project) return { ok: false, error: project.error }
  if (!sessionBelongsToProject(project.projectPath, sessionId)) {
    return {
      ok: false,
      error: toolResult({
        status: 'error',
        message: 'Session not found in the current project. Cross-project reads are not allowed.',
      }, true),
    }
  }
  return { ok: true, projectPath: project.projectPath }
}

export function sessionReadHandler(args: SessionReadArgs, deps: BuiltInSuperoneToolDeps) {
  const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : ''
  if (!sessionId) {
    return toolResult({ status: 'error', message: 'sessionId is required' }, true)
  }

  const gate = assertReadable(deps, sessionId)
  if (!gate.ok) return gate.error

  const view: SessionArchiveView = (['meta', 'user', 'assistant', 'text', 'tools', 'tool_detail'] as const)
    .includes(args.view as SessionArchiveView)
    ? (args.view as SessionArchiveView)
    : 'text'

  const db = getDb()
  const sessionRow = db.prepare(`
    SELECT id, title, created_at, last_user_message_at, is_worktree, is_pinned, is_hidden, git_branch, worktree_path,
           provider_id, provider, acp_agent_id, selected_model, selected_effort, total_cost_usd, context_tokens,
           api_provider_id
    FROM sessions WHERE id = ?
  `).get(sessionId) as {
    id: string
    title: string | null
    created_at: string
    last_user_message_at: string | null
    is_worktree: number | null
    is_pinned: number | null
    is_hidden: number | null
    git_branch: string | null
    worktree_path: string | null
    provider_id: string | null
    provider: string | null
    acp_agent_id: string | null
    selected_model: string | null
    selected_effort: string | null
    total_cost_usd: number | null
    context_tokens: number | null
    api_provider_id: string | null
  } | undefined

  if (!sessionRow) {
    return toolResult({ status: 'error', message: `Session not found: ${sessionId}` }, true)
  }

  const parent = db.prepare(`
    SELECT parent_session_id FROM session_collaboration_grants WHERE child_session_id = ? LIMIT 1
  `).get(sessionId) as { parent_session_id: string } | undefined

  const messageCount = (db.prepare(`
    SELECT COUNT(*) AS n FROM chat_messages WHERE session_id = ?
  `).get(sessionId) as { n: number }).n

  const header = {
    sessionId,
    title: sessionRow.title ?? 'Untitled',
    harness: deriveHarnessId(sessionRow),
    acpAgentId: sessionRow.acp_agent_id ?? null,
    model: sessionRow.selected_model ?? null,
    effort: sessionRow.selected_effort ?? null,
    createdAt: sessionRow.created_at,
    lastActiveAt: sessionRow.last_user_message_at ?? sessionRow.created_at,
    messageCount,
    pinned: !!sessionRow.is_pinned,
    hidden: !!sessionRow.is_hidden,
    branch: sessionRow.git_branch ?? null,
    worktreePath: sessionRow.worktree_path ?? null,
    parentId: parent?.parent_session_id ?? null,
    totalCostUsd: sessionRow.total_cost_usd ?? 0,
    contextTokens: sessionRow.context_tokens ?? 0,
    isSelf: sessionId === deps.sessionId,
  }

  if (view === 'meta') {
    return toolResult({ status: 'ok', view: 'meta', ...header })
  }

  if (view === 'tool_detail') {
    const toolUseId = typeof args.toolUseId === 'string' ? args.toolUseId.trim() : ''
    if (!toolUseId) {
      return toolResult({ status: 'error', message: 'tool_detail view requires toolUseId' }, true)
    }
    const messages = loadMessages(sessionId)
    const detail = findToolDetail(messages, toolUseId)
    if (!detail) {
      return toolResult({ status: 'error', message: `Tool use not found: ${toolUseId}` }, true)
    }
    return toolResult({ status: 'ok', view: 'tool_detail', sessionId, tool: detail })
  }

  const limit = clampLimit(args.limit, SESSION_READ_DEFAULT_LIMIT, SESSION_READ_MAX_LIMIT)
  const cursor = args.cursor === null || args.cursor === undefined
    ? null
    : typeof args.cursor === 'number' && Number.isFinite(args.cursor)
      ? Math.floor(args.cursor)
      : null
  const messageId = typeof args.messageId === 'string' ? args.messageId : undefined
  const around = typeof args.around === 'number' && Number.isFinite(args.around)
    ? Math.max(0, Math.floor(args.around))
    : undefined
  const includeThinking = args.includeThinking === true

  const allMessages = loadMessages(sessionId)

  if (view === 'tools') {
    // When messageId is set: index tools on a global-timeline window, then extract.
    // Otherwise: paginate messages that have tools.
    let source: ChatMessage[]
    let page: ReturnType<typeof pageItems<ChatMessage>>

    if (messageId) {
      page = pageItems(allMessages, { limit, cursor, messageId, around })
      source = page.items
    } else {
      const withTools = allMessages.filter((m) => countTools(m) > 0)
      page = pageItems(withTools, { limit, cursor })
      source = page.items
    }

    const entries = source.flatMap((m) => extractToolIndex(m))
    const body = formatToolIndex(entries)
    return toolResult([
      `# Session ${sessionId} — tools`,
      `title: ${header.title} · harness: ${header.harness} · tools on page: ${entries.length}`,
      `cursor: ${page.cursor === null ? 'null' : page.cursor} · hasMore: ${page.hasMore} · totalSource: ${page.total}`,
      '',
      body,
    ].join('\n'))
  }

  // user / assistant / text — pure conversation text, no tool lines
  let source: ChatMessage[]
  if (view === 'user') {
    source = allMessages.filter((m) => m.role === 'user')
  } else if (view === 'assistant') {
    source = allMessages.filter((m) => m.role === 'assistant')
  } else {
    source = allMessages
  }

  // messageId+around: anchor on the full timeline, then keep only matching roles
  let page: ReturnType<typeof pageItems<ChatMessage>>
  if (messageId && (view === 'user' || view === 'assistant')) {
    const global = pageItems(allMessages, { limit, cursor, messageId, around })
    const filtered = global.items.filter((m) =>
      view === 'user' ? m.role === 'user' : m.role === 'assistant',
    )
    page = {
      items: filtered,
      cursor: global.cursor,
      hasMore: global.hasMore,
      total: source.length,
      startIndex: global.startIndex,
      endIndex: global.endIndex,
    }
  } else {
    page = pageItems(source, { limit, cursor, messageId, around })
  }

  const body = formatTextMessages(page.items, {
    includeThinking,
    withToolCount: view === 'assistant' || view === 'text',
  })

  return toolResult([
    `# Session ${sessionId} — ${view}`,
    `title: ${header.title} · harness: ${header.harness} · messages: ${header.messageCount}`,
    `page: ${page.items.length} · cursor: ${page.cursor === null ? 'null' : page.cursor} · hasMore: ${page.hasMore} · totalInView: ${page.total}`,
    '',
    body || '_(no messages)_',
  ].join('\n'))
}

// --- session_cleanup ---
// Discover with session_list first; then hide/unhide immediately or delete with a host confirm dialog.

type CleanupConfirmOutcome = { action: 'accept' | 'decline' | 'cancel' }

const cleanupConfirms = new HostConfirmRegistry<CleanupConfirmOutcome>({
  idPrefix: 'sessioncleanup',
  timeoutMs: CLEANUP_CONFIRM_TIMEOUT_MS,
  timeoutError: () => new Error(`Session cleanup confirmation timed out after ${CLEANUP_CONFIRM_TIMEOUT_MS}ms`),
})

export function resolveSessionCleanupConfirm(
  requestId: string,
  action: 'accept' | 'decline' | 'cancel',
): boolean {
  return cleanupConfirms.settle(requestId, action === 'accept', { action })
}

export function rejectSessionCleanupConfirm(requestId: string, reason: string): boolean {
  return cleanupConfirms.fail(requestId, new Error(reason))
}

export interface SessionCleanupArgs {
  action: 'hide' | 'unhide' | 'delete'
  /** Required. Prefer ids from session_list. */
  sessionIds: string[]
  includePinned?: boolean
  maxDelete?: number
}

function resolveCleanupCandidates(
  projectId: string,
  args: SessionCleanupArgs,
  selfId: string,
): {
  candidates: ArchiveSessionRow[]
  skippedPinned: ArchiveSessionRow[]
  skippedSelf: string[]
  /** Eligible ids not acted on because maxDelete cap was hit (caller order). */
  omittedDueToMaxDelete: string[]
} {
  const maxDelete = clampLimit(args.maxDelete, SESSION_CLEANUP_MAX_DELETE, SESSION_CLEANUP_MAX_DELETE)
  const ids = (Array.isArray(args.sessionIds) ? args.sessionIds : [])
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (ids.length === 0) {
    return { candidates: [], skippedPinned: [], skippedSelf: [], omittedDueToMaxDelete: [] }
  }

  const placeholders = ids.map(() => '?').join(',')
  const db = getDb()
  // No size subquery — cleanup only needs metadata for confirm UI / pin checks.
  const rows = db.prepare(`
    SELECT s.id, s.title, s.created_at, s.is_worktree, s.is_pinned, s.is_hidden, s.git_branch, s.worktree_path,
           s.is_automation, s.provider_id, s.provider, s.acp_agent_id, s.selected_model,
           s.total_cost_usd, s.context_tokens,
           g.parent_session_id,
           COALESCE(s.last_user_message_at, s.created_at) AS last_user_msg_at,
           (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
           NULL AS size_bytes
    FROM sessions s
    LEFT JOIN session_collaboration_grants g ON g.child_session_id = s.id
    WHERE s.project_id = ? AND s.id IN (${placeholders})
  `).all(projectId, ...ids) as ArchiveSessionRow[]

  // Preserve caller order for stable UI / confirm lists
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ordered = ids.map((id) => byId.get(id)).filter((r): r is ArchiveSessionRow => !!r)

  const skippedPinned: ArchiveSessionRow[] = []
  const skippedSelf: string[] = []
  const candidates: ArchiveSessionRow[] = []
  const omittedDueToMaxDelete: string[] = []
  let capped = false

  for (const row of ordered) {
    if (row.id === selfId) {
      skippedSelf.push(row.id)
      continue
    }
    if (!args.includePinned && row.is_pinned) {
      skippedPinned.push(row)
      continue
    }
    if (capped || candidates.length >= maxDelete) {
      capped = true
      omittedDueToMaxDelete.push(row.id)
      continue
    }
    candidates.push(row)
    if (candidates.length >= maxDelete) capped = true
  }

  return { candidates, skippedPinned, skippedSelf, omittedDueToMaxDelete }
}

function childSessionIds(parentId: string): string[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT child_session_id AS id FROM session_collaboration_grants
    WHERE parent_session_id = ? AND child_session_id IS NOT NULL
  `).all(parentId) as Array<{ id: string }>
  return rows.map((r) => r.id)
}

async function disposeIfLive(deps: BuiltInSuperoneToolDeps, sessionId: string): Promise<void> {
  const host = deps.sessionHost as { disposeSession?: (id: string) => Promise<void> } | null
  if (!host?.disposeSession) return
  try {
    await host.disposeSession(sessionId)
  } catch (err) {
    log.warn('[session_cleanup] disposeSession failed sid=%s: %s', sessionId, err instanceof Error ? err.message : String(err))
  }
}

export async function sessionCleanupHandler(args: SessionCleanupArgs, deps: BuiltInSuperoneToolDeps) {
  const project = requireProject(deps)
  if ('error' in project) return project.error

  const action = args.action
  if (action !== 'hide' && action !== 'unhide' && action !== 'delete') {
    return toolResult({
      status: 'error',
      message: 'action must be hide | unhide | delete. Discover sessions with session_list first.',
    }, true)
  }

  if (!(Array.isArray(args.sessionIds) && args.sessionIds.length > 0)) {
    return toolResult({
      status: 'error',
      message: 'sessionIds is required. Call session_list to find ids, then pass them here.',
    }, true)
  }

  const { candidates, skippedPinned, skippedSelf, omittedDueToMaxDelete } = resolveCleanupCandidates(
    project.projectId,
    args,
    deps.sessionId,
  )

  const skipFields = {
    skippedPinned: skippedPinned.map((r) => ({ id: r.id, title: r.title ?? 'Untitled' })),
    skippedSelf,
    ...(omittedDueToMaxDelete.length > 0 ? { omittedDueToMaxDelete } : {}),
  }

  if (candidates.length === 0) {
    return toolResult({
      status: 'ok',
      action,
      affected: [],
      ...skipFields,
      message: omittedDueToMaxDelete.length > 0
        ? 'No sessions processed (maxDelete cap reached before any eligible id).'
        : 'No matching sessions to process.',
    })
  }

  const ids = candidates.map((c) => c.id)

  if (action === 'hide' || action === 'unhide') {
    const hidden = action === 'hide'
    for (const id of ids) hideSession(id, hidden)
    return toolResult({
      status: 'ok',
      action,
      affected: candidates.map((r) => ({ id: r.id, title: r.title ?? 'Untitled' })),
      ...skipFields,
    })
  }

  // delete — expand collab children (still skip pinned/self)
  const toDelete = new Set(ids)
  for (const id of ids) {
    for (const child of childSessionIds(id)) {
      if (child === deps.sessionId) continue
      toDelete.add(child)
    }
  }

  if (!args.includePinned) {
    const db = getDb()
    for (const id of [...toDelete]) {
      const row = db.prepare('SELECT is_pinned FROM sessions WHERE id = ?').get(id) as { is_pinned: number } | undefined
      if (row?.is_pinned) toDelete.delete(id)
    }
  }

  const finalIds = [...toDelete]
  if (finalIds.length === 0) {
    return toolResult({ status: 'ok', action: 'delete', deleted: [], message: 'Nothing left to delete after safety filters.' })
  }

  // Build confirm rows before delete (children may not be in candidates)
  const candidateById = new Map(candidates.map((c) => [c.id, c]))
  const confirmSessions: Array<{
    id: string
    title: string
    harness?: string
    acpAgentId?: string | null
    messageCount?: number
    createdAt?: string
  }> = []
  {
    const db = getDb()
    const getMeta = db.prepare(`
      SELECT s.id, s.title, s.created_at, s.provider_id, s.provider, s.acp_agent_id,
             (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count
      FROM sessions s WHERE s.id = ?
    `)
    for (const id of finalIds) {
      const c = candidateById.get(id)
      if (c) {
        confirmSessions.push({
          id: c.id,
          title: c.title ?? 'Untitled',
          harness: deriveHarnessId(c),
          acpAgentId: c.acp_agent_id ?? null,
          messageCount: c.message_count ?? 0,
          createdAt: c.created_at,
        })
        continue
      }
      const row = getMeta.get(id) as {
        id: string
        title: string | null
        created_at: string
        provider_id: string | null
        provider: string | null
        acp_agent_id: string | null
        message_count: number
      } | undefined
      if (!row) {
        confirmSessions.push({ id, title: 'Untitled' })
        continue
      }
      confirmSessions.push({
        id: row.id,
        title: row.title?.trim() ? row.title : 'Untitled',
        harness: deriveHarnessId(row),
        acpAgentId: row.acp_agent_id ?? null,
        messageCount: row.message_count ?? 0,
        createdAt: row.created_at,
      })
    }
  }
  const labelFor = (id: string) =>
    confirmSessions.find((s) => s.id === id)?.title ?? 'Untitled'

  const session = deps.sessionHost?.getSession(deps.sessionId)
  if (!session?.emitHostEvent) {
    return toolResult({
      status: 'error',
      message: 'Cannot open delete confirmation: current session host is unavailable.',
    }, true)
  }

  const confirmLines = confirmSessions.map((s) => `${s.title} (${s.id.slice(0, 8)})`)
  const message = `Permanently delete ${finalIds.length} session(s)?\n${confirmLines.slice(0, 15).join('\n')}${confirmLines.length > 15 ? `\n…and ${confirmLines.length - 15} more` : ''}`

  let outcome: CleanupConfirmOutcome
  try {
    outcome = await cleanupConfirms.open(session, (requestId) => ({
      requestId,
      toolName: 'mcp__superone__session_cleanup',
      toolUseId: requestId,
      input: { action: 'delete', sessionIds: finalIds },
      allowAlwaysAllow: false,
      serverName: 'superone',
      message,
      requestKind: 'session_cleanup_confirm',
      sessionCleanupConfirm: { sessions: confirmSessions },
    }), { signal: deps.signal, abortError: () => new Error('Session cleanup cancelled') })
  } catch (err) {
    // Match session collab: cancel/timeout are neutral outcomes (no isError), not tool failures.
    const message = err instanceof Error ? err.message : String(err)
    if (/timed out|cancelled/i.test(message)) {
      return toolResult({ status: 'cancelled', action: 'delete', message })
    }
    return toolResult({ status: 'error', message }, true)
  }

  if (outcome.action !== 'accept') {
    return toolResult({
      status: outcome.action === 'cancel' ? 'cancelled' : 'rejected',
      action: 'delete',
      message: 'User did not approve session deletion.',
    })
  }

  const deleted: Array<{ id: string; title: string }> = []
  const failed: Array<{ id: string; title: string; error: string }> = []
  for (const id of finalIds) {
    await disposeIfLive(deps, id)
    try {
      deleteSession(id)
      deleted.push({ id, title: labelFor(id) })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.warn('[session_cleanup] delete failed sid=%s: %s', id, error)
      failed.push({ id, title: labelFor(id), error })
    }
  }

  const status =
    failed.length === 0
      ? 'ok'
      : deleted.length === 0
        ? 'error'
        : 'partial'

  return toolResult({
    status,
    action: 'delete',
    deleted,
    ...(failed.length > 0 ? { failed } : {}),
    ...skipFields,
  }, status === 'error')
}

// --- Test helpers ---

export function _resetSessionCleanupConfirmsForTests(): void {
  cleanupConfirms.clearForTests()
}
