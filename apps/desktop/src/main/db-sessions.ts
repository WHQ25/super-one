import { getDb } from './database'
import { getProjectId } from './recent-folders'
import { serializeMessageContent, parseMessageContent, deriveHarnessId } from './session/session-repo'
import { recordSessionStarted, recordMessageCounts, type HarnessKind } from './usage-stats-service'
import type { ChatMessage, EffortLevel, SessionHistoryEntry, PinnedSessionEntry } from '@superone/shared/agent-types'
import { parseTagsJson } from '@superone/shared/session-tags'

interface DbSession {
  id: string
  project_id: string
  title: string | null
  created_at: string
  total_cost_usd: number | null
  context_tokens: number | null
}

interface DbChatMessage {
  id: string
  session_id: string
  sort_order: number
  role: string
  status: string
  content_json: string
  created_at: string
  provider_id: string
  metadata_json: string | null
  checkpoint_id: string | null
  resume_point_id: string | null
}

/** List sessions for a project id from DB (Environment API / local gateway path). */
export function listSessionsForProjectId(
  projectId: string,
  limit?: number,
  offset?: number,
): SessionHistoryEntry[] {
  if (!projectId) return []

  const db = getDb()
  const baseSql = `
    WITH related_sessions AS (
      SELECT s.id, s.title, s.created_at, s.is_worktree, s.is_pinned, s.is_hidden, s.git_branch, s.worktree_path,
             s.is_automation, s.automation_id, s.provider_session_id, s.provider_id, s.provider, s.acp_agent_id,
             s.tags_json,
             g.parent_session_id,
             COALESCE(g.parent_session_id, s.id) AS root_session_id,
             COALESCE(s.last_user_message_at, s.created_at) AS last_user_msg_at
      FROM sessions s
      LEFT JOIN session_collaboration_grants g
        ON g.child_session_id = s.id
        AND COALESCE(g.kind, 'spawn') = 'spawn'
      WHERE s.project_id = ?
    ), grouped_sessions AS (
      SELECT related_sessions.*,
             MAX(last_user_msg_at) OVER (PARTITION BY root_session_id) AS group_last_active_at
      FROM related_sessions
    )
    SELECT *
    FROM grouped_sessions
    ORDER BY group_last_active_at DESC,
             CASE WHEN parent_session_id IS NULL THEN 0 ELSE 1 END,
             last_user_msg_at DESC`
  const safeOffset = Math.max(0, offset ?? 0)
  // Match remote SessionRuntime.list: apply offset even when limit is omitted.
  // SQLite requires LIMIT with OFFSET; LIMIT -1 means "no upper bound".
  const rows = (limit != null
    ? db.prepare(`${baseSql} LIMIT ? OFFSET ?`).all(projectId, limit, safeOffset)
    : safeOffset > 0
      ? db.prepare(`${baseSql} LIMIT -1 OFFSET ?`).all(projectId, safeOffset)
      : db.prepare(baseSql).all(projectId)
  ) as Array<{ id: string; title: string | null; created_at: string; last_user_msg_at: string; is_worktree: number | null; is_pinned: number | null; is_hidden: number | null; git_branch: string | null; worktree_path: string | null; is_automation: number | null; automation_id: string | null; provider_session_id: string | null; provider_id: string | null; provider: string | null; acp_agent_id: string | null; parent_session_id: string | null; tags_json: string | null }>

  return rows.map((r) => {
    const tags = parseTagsJson(r.tags_json)
    return {
      sessionId: r.id,
      title: r.title ?? 'Untitled',
      lastActiveAt: r.last_user_msg_at,
      provider: deriveHarnessId(r),
      messageCount: 0,
      ...(r.is_worktree ? { isWorktree: true } : {}),
      ...(r.is_pinned ? { isPinned: true } : {}),
      ...(r.is_hidden ? { isHidden: true } : {}),
      ...(r.git_branch ? { gitBranch: r.git_branch } : {}),
      ...(r.worktree_path ? { worktreePath: r.worktree_path } : {}),
      ...(r.is_automation ? { isAutomation: true } : {}),
      ...(r.automation_id ? { automationId: r.automation_id } : {}),
      ...(r.provider_session_id ? { providerSessionId: r.provider_session_id } : {}),
      ...(r.acp_agent_id ? { acpAgentId: r.acp_agent_id } : {}),
      ...(r.parent_session_id ? { parentSessionId: r.parent_session_id } : {}),
      ...(tags.length ? { tags } : {}),
    }
  })
}

/** List sessions for a project folder from DB (no external sync). */
export function listSessionsForFolder(folderPath: string, limit?: number, offset?: number): SessionHistoryEntry[] {
  const projectId = getProjectId(folderPath)
  if (!projectId) return []
  return listSessionsForProjectId(projectId, limit, offset)
}

/** Create a new session record in DB. `sessionId` is the stable Session.id used across the app. */
export function createSession(folderPath: string, sessionId: string, title?: string, isWorktree?: boolean, gitBranch?: string, worktreePath?: string): string {
  const projectId = getProjectId(folderPath)
  if (!projectId) throw new Error(`Project not found for path: ${folderPath}`)

  const db = getDb()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO sessions (id, project_id, title, created_at, last_user_message_at, is_worktree, git_branch, worktree_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = CASE WHEN title IS NULL OR title = '' THEN COALESCE(excluded.title, title) ELSE title END,
      git_branch = COALESCE(excluded.git_branch, git_branch),
      worktree_path = COALESCE(excluded.worktree_path, worktree_path)
  `).run(sessionId, projectId, title ?? null, now, now, isWorktree ? 1 : 0, gitBranch ?? null, worktreePath ?? null)

  return sessionId
}

export function createAutomationSession(
  folderPath: string,
  sessionId: string,
  title: string,
  automationId: string,
  provider: 'claude' | 'codex' | 'acp' | 'opencode' = 'claude',
): string {
  const projectId = getProjectId(folderPath)
  if (!projectId) throw new Error(`Project not found for path: ${folderPath}`)

  const db = getDb()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO sessions (id, project_id, title, created_at, last_user_message_at, is_automation, automation_id, provider, is_pinned)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1)
  `).run(sessionId, projectId, title, now, now, automationId, provider)

  return sessionId
}

export function renameSession(sessionId: string, title: string, source: 'user' | 'agent' = 'user'): void {
  const db = getDb()
  if (source === 'user') {
    db.prepare('UPDATE sessions SET title = ?, is_user_renamed = 1 WHERE id = ?').run(title, sessionId)
  } else {
    db.prepare('UPDATE sessions SET title = ? WHERE id = ? AND is_user_renamed = 0').run(title, sessionId)
  }
}

export function isSessionUserRenamed(sessionId: string): boolean {
  const row = getDb().prepare('SELECT is_user_renamed FROM sessions WHERE id = ?').get(sessionId) as { is_user_renamed: number } | undefined
  return row?.is_user_renamed === 1
}

export function getSessionTags(sessionId: string): string[] | null {
  const row = getDb().prepare('SELECT tags_json FROM sessions WHERE id = ?').get(sessionId) as { tags_json: string | null } | undefined
  if (!row) return null
  return parseTagsJson(row.tags_json)
}

/** Returns false when the session id is unknown. */
export function setSessionTags(sessionId: string, tags: string[]): boolean {
  const result = getDb().prepare('UPDATE sessions SET tags_json = ? WHERE id = ?').run(JSON.stringify(tags), sessionId)
  return result.changes > 0
}

/** Save full session state to DB: upsert messages into chat_messages, update session metadata */
export function saveSessionState(
  sessionId: string,
  data: { messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; title?: string; provider?: string },
): void {
  const db = getDb()
  const lastUserMessageAt = [...data.messages].reverse().find((msg) => msg.role === 'user')?.createdAt ?? null

  const upsertMsg = db.prepare(`
    INSERT INTO chat_messages (id, session_id, sort_order, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id, usage_counted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      content_json = excluded.content_json,
      metadata_json = excluded.metadata_json,
      checkpoint_id = excluded.checkpoint_id,
      resume_point_id = excluded.resume_point_id,
      usage_counted_at = COALESCE(chat_messages.usage_counted_at, excluded.usage_counted_at)
  `)

  const updateSession = data.title
    ? db.prepare(`
        UPDATE sessions
        SET total_cost_usd = ?, context_tokens = ?, provider = ?, last_user_message_at = COALESCE(?, last_user_message_at, created_at),
            title = CASE WHEN title IS NULL OR title = '' THEN ? ELSE title END
        WHERE id = ?
      `)
    : db.prepare(`
        UPDATE sessions
        SET total_cost_usd = ?, context_tokens = ?, provider = ?, last_user_message_at = COALESCE(?, last_user_message_at, created_at)
        WHERE id = ?
      `)

  const sessionRow = db.prepare(`
    SELECT created_at, usage_counted_at FROM sessions WHERE id = ?
  `).get(sessionId) as { created_at: string; usage_counted_at: string | null } | undefined

  const priorCounted = db.prepare(`
    SELECT id FROM chat_messages WHERE session_id = ? AND usage_counted_at IS NOT NULL
  `).all(sessionId) as Array<{ id: string }>
  const priorCountedIds = new Set(priorCounted.map((r) => r.id))

  const provider = data.provider ?? 'claude'
  const harness: HarnessKind | null =
    provider === 'codex'
    || provider === 'claude'
    || provider === 'cursor'
    || provider === 'opencode'
    || provider === 'acp'
      ? provider as HarnessKind
      : null

  const newlyCountedMessages: Array<{ role: string; createdAt: string }> = []
  let countSessionStarted = false

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId)
    for (let i = 0; i < data.messages.length; i++) {
      const msg = data.messages[i]
      const isAssistantComplete = msg.role === 'assistant' && msg.status === 'complete'
      const isUser = msg.role === 'user'
      const wasAlreadyCounted = priorCountedIds.has(msg.id)
      const shouldCount = !wasAlreadyCounted && (isUser || isAssistantComplete)
      const usageCountedAt = wasAlreadyCounted || shouldCount ? new Date().toISOString() : null

      upsertMsg.run(
        msg.id,
        sessionId,
        i,
        msg.role,
        msg.status === 'streaming' ? 'interrupted' : msg.status,
        serializeMessageContent(msg),
        msg.createdAt,
        msg.providerId,
        msg.metadata ? JSON.stringify(msg.metadata) : null,
        msg.checkpointId ?? null,
        msg.resumePointId ?? null,
        usageCountedAt,
      )

      if (shouldCount) {
        newlyCountedMessages.push({ role: msg.role, createdAt: msg.createdAt })
      }
    }

    if (data.title) {
      updateSession.run(data.totalCostUsd, data.contextTokens, provider, lastUserMessageAt, data.title, sessionId)
    } else {
      updateSession.run(data.totalCostUsd, data.contextTokens, provider, lastUserMessageAt, sessionId)
    }

    if (sessionRow && !sessionRow.usage_counted_at) {
      db.prepare('UPDATE sessions SET usage_counted_at = ? WHERE id = ?').run(new Date().toISOString(), sessionId)
      countSessionStarted = true
    }
  })

  tx()

  if (harness) {
    if (countSessionStarted && sessionRow) {
      recordSessionStarted(harness, sessionRow.created_at)
    }
    if (newlyCountedMessages.length > 0) {
      const userByDay = new Map<string, number>()
      const assistantByDay = new Map<string, number>()
      for (const m of newlyCountedMessages) {
        if (m.role === 'user') {
          userByDay.set(m.createdAt, (userByDay.get(m.createdAt) ?? 0) + 1)
        } else if (m.role === 'assistant') {
          assistantByDay.set(m.createdAt, (assistantByDay.get(m.createdAt) ?? 0) + 1)
        }
      }
      for (const [createdAt, n] of userByDay) {
        recordMessageCounts(harness, createdAt, { userMessages: n })
      }
      for (const [createdAt, n] of assistantByDay) {
        recordMessageCounts(harness, createdAt, { assistantMessages: n })
      }
    }
  }
}

/** Load session state from DB */
export function loadSessionState(
  sessionId: string,
): { messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; isWorktree: boolean; gitBranch: string | null; worktreePath: string | null; provider: string; apiProviderId: string | null; acpAgentId: string | null; selectedModel: string | null; selectedEffort: EffortLevel | null; title: string | null } | null {
  const db = getDb()

  const session = db.prepare(`
    SELECT title, total_cost_usd, context_tokens, is_worktree, git_branch, worktree_path, provider, provider_id, api_provider_id, acp_agent_id, selected_model, selected_effort FROM sessions WHERE id = ?
  `).get(sessionId) as (DbSession & { is_worktree: number | null; git_branch: string | null; worktree_path: string | null; provider: string | null; provider_id: string | null; api_provider_id: string | null; acp_agent_id: string | null; selected_model: string | null; selected_effort: string | null }) | undefined

  if (!session) return null

  const rows = db.prepare(`
    SELECT id, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY sort_order ASC
  `).all(sessionId) as DbChatMessage[]

  if (rows.length === 0) return null

  const messages: ChatMessage[] = rows.map((r) => {
    const parsed = parseMessageContent(r.content_json)
    return {
      id: r.id,
      role: r.role as ChatMessage['role'],
      status: (r.status === 'streaming' ? 'interrupted' : r.status) as ChatMessage['status'],
      content: parsed.content,
      ...(parsed.attachments ? { attachments: parsed.attachments } : {}),
      ...(parsed.contexts ? { contexts: parsed.contexts } : {}),
      ...(parsed.userSelections ? { userSelections: parsed.userSelections } : {}),
      createdAt: r.created_at,
      providerId: r.provider_id,
      ...(r.metadata_json ? { metadata: JSON.parse(r.metadata_json) } : {}),
      ...(r.checkpoint_id ? { checkpointId: r.checkpoint_id } : {}),
      ...(r.resume_point_id ? { resumePointId: r.resume_point_id } : {}),
    }
  })

  return {
    messages,
    totalCostUsd: session.total_cost_usd ?? 0,
    contextTokens: session.context_tokens ?? 0,
    isWorktree: !!(session.is_worktree),
    gitBranch: session.git_branch ?? null,
    worktreePath: session.worktree_path ?? null,
    provider: deriveHarnessId(session),
    apiProviderId: session.api_provider_id ?? null,
    acpAgentId: session.acp_agent_id ?? null,
    selectedModel: session.selected_model ?? null,
    selectedEffort: (session.selected_effort as EffortLevel | null) ?? null,
    title: session.title ?? null,
  }
}

export function sessionBelongsToProject(folderPath: string, sessionId: string): boolean {
  const projectId = getProjectId(folderPath)
  if (!projectId) return false
  const db = getDb()
  const row = db.prepare(`
    SELECT 1 AS found
    FROM sessions
    WHERE project_id = ? AND id = ?
    LIMIT 1
  `).get(projectId, sessionId) as { found: number } | undefined
  return !!row
}

export function loadSessionMessagesPaginated(
  sessionId: string,
  limit: number,
  cursor?: number,
): { messages: ChatMessage[]; cursor: number | null; hasMore: boolean } {
  const db = getDb()
  const rows = db.prepare(`
    SELECT id, sort_order, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY sort_order ASC
  `).all(sessionId) as (DbChatMessage & { sort_order: number })[]

  const endIndex = cursor ?? rows.length
  const startIndex = Math.max(0, endIndex - limit)
  const slice = rows.slice(startIndex, endIndex)
  const hasMore = startIndex > 0

  const messages: ChatMessage[] = slice.map((r) => {
    const parsed = parseMessageContent(r.content_json)
    return {
      id: r.id,
      role: r.role as ChatMessage['role'],
      status: (r.status === 'streaming' ? 'interrupted' : r.status) as ChatMessage['status'],
      content: parsed.content,
      ...(parsed.attachments ? { attachments: parsed.attachments } : {}),
      ...(parsed.contexts ? { contexts: parsed.contexts } : {}),
      ...(parsed.userSelections ? { userSelections: parsed.userSelections } : {}),
      createdAt: r.created_at,
      providerId: r.provider_id,
      ...(r.metadata_json ? { metadata: JSON.parse(r.metadata_json) } : {}),
      ...(r.checkpoint_id ? { checkpointId: r.checkpoint_id } : {}),
      ...(r.resume_point_id ? { resumePointId: r.resume_point_id } : {}),
    }
  })

  return { messages, cursor: hasMore ? startIndex : null, hasMore }
}

/** Delete a session and its messages (cascade). */
export function deleteSession(sessionId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
}

/** Delete non-pinned sessions older than cutoffDate for a project. Returns deleted session IDs. */
export function deleteSessionsOlderThan(folderPath: string, cutoffDate: string): string[] {
  const projectId = getProjectId(folderPath)
  if (!projectId) return []

  const db = getDb()

  const rows = db.prepare(`
    SELECT s.id
    FROM sessions s
    WHERE s.project_id = ?
      AND COALESCE(s.is_pinned, 0) = 0
      AND COALESCE(s.last_user_message_at, s.created_at) < ?
  `).all(projectId, cutoffDate) as Array<{ id: string }>

  const ids = rows.map((r) => r.id)
  if (ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`).run(...ids)

  return ids
}

/** Pin or unpin a session. */
export function pinSession(sessionId: string, pinned: boolean): void {
  const db = getDb()
  db.prepare('UPDATE sessions SET is_pinned = ? WHERE id = ?').run(pinned ? 1 : 0, sessionId)
}

/** Hide or unhide a session. */
export function hideSession(sessionId: string, hidden: boolean): void {
  const db = getDb()
  db.prepare('UPDATE sessions SET is_hidden = ? WHERE id = ?').run(hidden ? 1 : 0, sessionId)
}

/** List all pinned sessions across all projects. */
export function listPinnedSessions(): PinnedSessionEntry[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT s.id, s.title, s.created_at, s.is_worktree, s.is_automation, s.automation_id, s.provider_session_id,
           s.provider_id, s.provider, s.acp_agent_id,
           p.path AS folder_path, p.name AS folder_name,
           COALESCE(s.last_user_message_at, s.created_at) AS last_user_msg_at
    FROM sessions s
    JOIN projects p ON p.id = s.project_id
    WHERE s.is_pinned = 1 AND COALESCE(s.is_hidden, 0) = 0
    ORDER BY last_user_msg_at DESC
  `).all() as Array<{ id: string; title: string | null; created_at: string; last_user_msg_at: string; is_worktree: number | null; is_automation: number | null; automation_id: string | null; provider_session_id: string | null; provider_id: string | null; provider: string | null; acp_agent_id: string | null; folder_path: string; folder_name: string }>

  return rows.map((r) => ({
    sessionId: r.id,
    title: r.title ?? 'Untitled',
    lastActiveAt: r.last_user_msg_at,
    provider: deriveHarnessId(r),
    messageCount: 0,
    ...(r.is_worktree ? { isWorktree: true } : {}),
    ...(r.is_automation ? { isAutomation: true } : {}),
    ...(r.automation_id ? { automationId: r.automation_id } : {}),
    ...(r.provider_session_id ? { providerSessionId: r.provider_session_id } : {}),
    ...(r.acp_agent_id ? { acpAgentId: r.acp_agent_id } : {}),
    isPinned: true,
    folderPath: r.folder_path,
    folderName: r.folder_name,
  }))
}
