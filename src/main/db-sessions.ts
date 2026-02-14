import { randomUUID } from 'crypto'
import { getDb } from './database'
import { getProjectId } from './recent-folders'
import type { ChatMessage, SessionHistoryEntry, PinnedSessionEntry } from '../shared/agent-types'

interface DbSession {
  id: string
  project_id: string
  claude_session_id: string | null
  title: string | null
  created_at: string
  total_cost_usd: number | null
  context_tokens: number | null
}

interface DbChatMessage {
  id: string
  claude_session_id: string
  sort_order: number
  role: string
  status: string
  content_json: string
  created_at: string
  provider_id: string
  metadata_json: string | null
}

/** List sessions for a project folder from DB (no external sync). */
export function listSessionsForFolder(folderPath: string): SessionHistoryEntry[] {
  const projectId = getProjectId(folderPath)
  if (!projectId) return []

  const db = getDb()
  const rows = db.prepare(`
    SELECT s.id, s.claude_session_id, s.title, s.created_at, s.is_worktree, s.is_pinned,
           COALESCE(
             (SELECT MAX(m.created_at) FROM chat_messages m
              WHERE m.claude_session_id = s.claude_session_id AND m.role = 'user'),
             s.created_at
           ) AS last_user_msg_at,
           CASE
             WHEN s.claude_session_id LIKE 'codex_local_%' THEN 'codex'
             WHEN EXISTS (
               SELECT 1 FROM chat_messages m2
               WHERE m2.claude_session_id = s.claude_session_id
                 AND m2.provider_id = 'codex'
             ) THEN 'codex'
             ELSE 'claude'
           END AS provider
    FROM sessions s
    WHERE s.project_id = ?
    ORDER BY last_user_msg_at DESC
  `).all(projectId) as Array<{ id: string; claude_session_id: string | null; title: string | null; created_at: string; last_user_msg_at: string; is_worktree: number | null; is_pinned: number | null; provider: 'claude' | 'codex' }>

  return rows.map((r) => ({
    sessionId: r.claude_session_id ?? r.id,
    title: r.title ?? 'Untitled',
    lastActiveAt: r.last_user_msg_at,
    provider: r.provider,
    messageCount: 0,
    ...(r.is_worktree ? { isWorktree: true } : {}),
    ...(r.is_pinned ? { isPinned: true } : {}),
  }))
}

/** Create a new session record in DB */
export function createSession(folderPath: string, claudeSessionId: string, title?: string, isWorktree?: boolean, gitBranch?: string): string {
  const projectId = getProjectId(folderPath)
  if (!projectId) throw new Error(`Project not found for path: ${folderPath}`)

  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO sessions (id, project_id, claude_session_id, title, created_at, is_worktree, git_branch)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(claude_session_id) DO UPDATE SET
      git_branch = COALESCE(excluded.git_branch, git_branch)
  `).run(id, projectId, claudeSessionId, title ?? null, now, isWorktree ? 1 : 0, gitBranch ?? null)

  return id
}

/** Update session title */
export function renameSession(claudeSessionId: string, title: string): void {
  const db = getDb()
  db.prepare('UPDATE sessions SET title = ? WHERE claude_session_id = ?').run(title, claudeSessionId)
}

/** Save full session state to DB: upsert messages into chat_messages, update session metadata */
export function saveSessionState(
  claudeSessionId: string,
  data: { messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; title?: string; provider?: string },
): void {
  const db = getDb()

  const upsertMsg = db.prepare(`
    INSERT INTO chat_messages (id, claude_session_id, sort_order, role, status, content_json, created_at, provider_id, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      content_json = excluded.content_json,
      metadata_json = excluded.metadata_json
  `)

  const updateSession = data.title
    ? db.prepare(`
        UPDATE sessions
        SET total_cost_usd = ?, context_tokens = ?, provider = ?,
            title = CASE WHEN title IS NULL OR title = '' THEN ? ELSE title END
        WHERE claude_session_id = ?
      `)
    : db.prepare(`
        UPDATE sessions
        SET total_cost_usd = ?, context_tokens = ?, provider = ?
        WHERE claude_session_id = ?
      `)

  // Skip messages still streaming — they haven't completed and shouldn't be persisted
  const settled = data.messages.filter((m) => m.status !== 'streaming')

  const tx = db.transaction(() => {
    for (let i = 0; i < settled.length; i++) {
      const msg = settled[i]
      upsertMsg.run(
        msg.id,
        claudeSessionId,
        i,
        msg.role,
        msg.status,
        JSON.stringify(msg.content),
        msg.createdAt,
        msg.providerId,
        msg.metadata ? JSON.stringify(msg.metadata) : null,
      )
    }

    const provider = data.provider ?? 'claude'
    if (data.title) {
      updateSession.run(data.totalCostUsd, data.contextTokens, provider, data.title, claudeSessionId)
    } else {
      updateSession.run(data.totalCostUsd, data.contextTokens, provider, claudeSessionId)
    }
  })

  tx()
}

/** Load session state from DB */
export function loadSessionState(
  claudeSessionId: string,
): { messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; isWorktree: boolean; gitBranch: string | null; provider: string } | null {
  const db = getDb()

  const session = db.prepare(`
    SELECT total_cost_usd, context_tokens, is_worktree, git_branch, provider FROM sessions WHERE claude_session_id = ?
  `).get(claudeSessionId) as (DbSession & { is_worktree: number | null; git_branch: string | null; provider: string | null }) | undefined

  if (!session) return null

  const rows = db.prepare(`
    SELECT id, role, status, content_json, created_at, provider_id, metadata_json
    FROM chat_messages
    WHERE claude_session_id = ?
    ORDER BY sort_order ASC
  `).all(claudeSessionId) as DbChatMessage[]

  if (rows.length === 0) return null

  const messages: ChatMessage[] = rows.map((r) => ({
    id: r.id,
    role: r.role as ChatMessage['role'],
    status: r.status as ChatMessage['status'],
    content: JSON.parse(r.content_json),
    createdAt: r.created_at,
    providerId: r.provider_id,
    ...(r.metadata_json ? { metadata: JSON.parse(r.metadata_json) } : {}),
  }))

  return {
    messages,
    totalCostUsd: session.total_cost_usd ?? 0,
    contextTokens: session.context_tokens ?? 0,
    isWorktree: !!(session.is_worktree),
    gitBranch: session.git_branch ?? null,
    provider: session.provider ?? 'claude',
  }
}

/** Delete a session and its messages (cascade). */
export function deleteSession(claudeSessionId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE claude_session_id = ?').run(claudeSessionId)
}

/** Pin or unpin a session. */
export function pinSession(claudeSessionId: string, pinned: boolean): void {
  const db = getDb()
  db.prepare('UPDATE sessions SET is_pinned = ? WHERE claude_session_id = ?').run(pinned ? 1 : 0, claudeSessionId)
}

/** List all pinned sessions across all projects. */
export function listPinnedSessions(): PinnedSessionEntry[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT s.id, s.claude_session_id, s.title, s.created_at, s.is_worktree,
           p.path AS folder_path, p.name AS folder_name,
           COALESCE(
             (SELECT MAX(m.created_at) FROM chat_messages m
              WHERE m.claude_session_id = s.claude_session_id AND m.role = 'user'),
             s.created_at
           ) AS last_user_msg_at,
           CASE
             WHEN s.claude_session_id LIKE 'codex_local_%' THEN 'codex'
             WHEN EXISTS (
               SELECT 1 FROM chat_messages m2
               WHERE m2.claude_session_id = s.claude_session_id
                 AND m2.provider_id = 'codex'
             ) THEN 'codex'
             ELSE 'claude'
           END AS provider
    FROM sessions s
    JOIN projects p ON p.id = s.project_id
    WHERE s.is_pinned = 1
    ORDER BY last_user_msg_at DESC
  `).all() as Array<{ id: string; claude_session_id: string | null; title: string | null; created_at: string; last_user_msg_at: string; is_worktree: number | null; folder_path: string; folder_name: string; provider: 'claude' | 'codex' }>

  return rows.map((r) => ({
    sessionId: r.claude_session_id ?? r.id,
    title: r.title ?? 'Untitled',
    lastActiveAt: r.last_user_msg_at,
    provider: r.provider,
    messageCount: 0,
    ...(r.is_worktree ? { isWorktree: true } : {}),
    isPinned: true,
    folderPath: r.folder_path,
    folderName: r.folder_name,
  }))
}
