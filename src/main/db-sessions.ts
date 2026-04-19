import { getDb } from './database'
import { getProjectId } from './recent-folders'
import type { ChatMessage, SessionHistoryEntry, PinnedSessionEntry } from '../shared/agent-types'

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

/** List sessions for a project folder from DB (no external sync). */
export function listSessionsForFolder(folderPath: string, limit?: number, offset?: number): SessionHistoryEntry[] {
  const projectId = getProjectId(folderPath)
  if (!projectId) return []

  const db = getDb()
  const baseSql = `
    SELECT s.id, s.title, s.created_at, s.is_worktree, s.is_pinned, s.is_hidden, s.git_branch, s.worktree_path,
           s.is_automation, s.automation_id, s.provider_session_id,
           COALESCE(s.last_user_message_at, s.created_at) AS last_user_msg_at,
           COALESCE(NULLIF(s.provider, ''), 'claude') AS provider
    FROM sessions s
    WHERE s.project_id = ?
    ORDER BY last_user_msg_at DESC`
  const rows = (limit != null
    ? db.prepare(`${baseSql} LIMIT ? OFFSET ?`).all(projectId, limit, offset ?? 0)
    : db.prepare(baseSql).all(projectId)
  ) as Array<{ id: string; title: string | null; created_at: string; last_user_msg_at: string; is_worktree: number | null; is_pinned: number | null; is_hidden: number | null; git_branch: string | null; worktree_path: string | null; is_automation: number | null; automation_id: string | null; provider_session_id: string | null; provider: 'claude' | 'codex' }>

  return rows.map((r) => ({
    sessionId: r.id,
    title: r.title ?? 'Untitled',
    lastActiveAt: r.last_user_msg_at,
    provider: r.provider,
    messageCount: 0,
    ...(r.is_worktree ? { isWorktree: true } : {}),
    ...(r.is_pinned ? { isPinned: true } : {}),
    ...(r.is_hidden ? { isHidden: true } : {}),
    ...(r.git_branch ? { gitBranch: r.git_branch } : {}),
    ...(r.worktree_path ? { worktreePath: r.worktree_path } : {}),
    ...(r.is_automation ? { isAutomation: true } : {}),
    ...(r.automation_id ? { automationId: r.automation_id } : {}),
    ...(r.provider_session_id ? { providerSessionId: r.provider_session_id } : {}),
  }))
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

export function createAutomationSession(folderPath: string, sessionId: string, title: string, automationId: string, provider: 'claude' | 'codex' = 'claude'): string {
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

/** Update session title */
export function renameSession(sessionId: string, title: string): void {
  const db = getDb()
  db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sessionId)
}

/** Save full session state to DB: upsert messages into chat_messages, update session metadata */
export function saveSessionState(
  sessionId: string,
  data: { messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; title?: string; provider?: string },
): void {
  const db = getDb()
  const lastUserMessageAt = [...data.messages].reverse().find((msg) => msg.role === 'user')?.createdAt ?? null

  const upsertMsg = db.prepare(`
    INSERT INTO chat_messages (id, session_id, sort_order, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      content_json = excluded.content_json,
      metadata_json = excluded.metadata_json,
      checkpoint_id = excluded.checkpoint_id,
      resume_point_id = excluded.resume_point_id
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

  const deleteStale = db.prepare('DELETE FROM chat_messages WHERE session_id = ?')

  const tx = db.transaction(() => {
    deleteStale.run(sessionId)
    for (let i = 0; i < data.messages.length; i++) {
      const msg = data.messages[i]
      upsertMsg.run(
        msg.id,
        sessionId,
        i,
        msg.role,
        msg.status === 'streaming' ? 'interrupted' : msg.status,
        JSON.stringify(msg.content),
        msg.createdAt,
        msg.providerId,
        msg.metadata ? JSON.stringify(msg.metadata) : null,
        msg.checkpointId ?? null,
        msg.resumePointId ?? null,
      )
    }

    const provider = data.provider ?? 'claude'
    if (data.title) {
      updateSession.run(data.totalCostUsd, data.contextTokens, provider, lastUserMessageAt, data.title, sessionId)
    } else {
      updateSession.run(data.totalCostUsd, data.contextTokens, provider, lastUserMessageAt, sessionId)
    }
  })

  tx()
}

/** Load session state from DB */
export function loadSessionState(
  sessionId: string,
): { messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; isWorktree: boolean; gitBranch: string | null; worktreePath: string | null; provider: string } | null {
  const db = getDb()

  const session = db.prepare(`
    SELECT total_cost_usd, context_tokens, is_worktree, git_branch, worktree_path, provider FROM sessions WHERE id = ?
  `).get(sessionId) as (DbSession & { is_worktree: number | null; git_branch: string | null; worktree_path: string | null; provider: string | null }) | undefined

  if (!session) return null

  const rows = db.prepare(`
    SELECT id, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY sort_order ASC
  `).all(sessionId) as DbChatMessage[]

  if (rows.length === 0) return null

  const messages: ChatMessage[] = rows.map((r) => ({
    id: r.id,
    role: r.role as ChatMessage['role'],
    status: (r.status === 'streaming' ? 'interrupted' : r.status) as ChatMessage['status'],
    content: JSON.parse(r.content_json),
    createdAt: r.created_at,
    providerId: r.provider_id,
    ...(r.metadata_json ? { metadata: JSON.parse(r.metadata_json) } : {}),
    ...(r.checkpoint_id ? { checkpointId: r.checkpoint_id } : {}),
    ...(r.resume_point_id ? { resumePointId: r.resume_point_id } : {}),
  }))

  return {
    messages,
    totalCostUsd: session.total_cost_usd ?? 0,
    contextTokens: session.context_tokens ?? 0,
    isWorktree: !!(session.is_worktree),
    gitBranch: session.git_branch ?? null,
    worktreePath: session.worktree_path ?? null,
    provider: session.provider ?? 'claude',
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

  const messages: ChatMessage[] = slice.map((r) => ({
    id: r.id,
    role: r.role as ChatMessage['role'],
    status: (r.status === 'streaming' ? 'interrupted' : r.status) as ChatMessage['status'],
    content: JSON.parse(r.content_json),
    createdAt: r.created_at,
    providerId: r.provider_id,
    ...(r.metadata_json ? { metadata: JSON.parse(r.metadata_json) } : {}),
    ...(r.checkpoint_id ? { checkpointId: r.checkpoint_id } : {}),
    ...(r.resume_point_id ? { resumePointId: r.resume_point_id } : {}),
  }))

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
           p.path AS folder_path, p.name AS folder_name,
           COALESCE(s.last_user_message_at, s.created_at) AS last_user_msg_at,
           COALESCE(NULLIF(s.provider, ''), 'claude') AS provider
    FROM sessions s
    JOIN projects p ON p.id = s.project_id
    WHERE s.is_pinned = 1 AND COALESCE(s.is_hidden, 0) = 0
    ORDER BY last_user_msg_at DESC
  `).all() as Array<{ id: string; title: string | null; created_at: string; last_user_msg_at: string; is_worktree: number | null; is_automation: number | null; automation_id: string | null; provider_session_id: string | null; folder_path: string; folder_name: string; provider: 'claude' | 'codex' }>

  return rows.map((r) => ({
    sessionId: r.id,
    title: r.title ?? 'Untitled',
    lastActiveAt: r.last_user_msg_at,
    provider: r.provider,
    messageCount: 0,
    ...(r.is_worktree ? { isWorktree: true } : {}),
    ...(r.is_automation ? { isAutomation: true } : {}),
    ...(r.automation_id ? { automationId: r.automation_id } : {}),
    ...(r.provider_session_id ? { providerSessionId: r.provider_session_id } : {}),
    isPinned: true,
    folderPath: r.folder_path,
    folderName: r.folder_name,
  }))
}
