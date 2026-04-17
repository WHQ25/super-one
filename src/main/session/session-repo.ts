import { getDb } from '../database'
import { getProjectId } from '../recent-folders'
import type { ChatMessage } from '../../shared/agent-types'
import type { HarnessId } from './types'

export interface SessionRecord {
  id: string
  projectPath: string
  projectId: string
  providerId: string
  harnessId: HarnessId
  providerSessionId: string | null
  title: string | null
  isWorktree: boolean
  gitBranch: string | null
  worktreePath: string | null
  isPinned: boolean
  isHidden: boolean
  totalCostUsd: number
  contextTokens: number
  createdAt: string
  lastUserMessageAt: string | null
}

interface SessionRow {
  id: string
  project_id: string
  claude_session_id: string | null
  provider_id: string | null
  provider_session_id: string | null
  provider: string | null
  title: string | null
  created_at: string
  last_user_message_at: string | null
  total_cost_usd: number | null
  context_tokens: number | null
  is_worktree: number | null
  git_branch: string | null
  worktree_path: string | null
  is_pinned: number | null
  is_hidden: number | null
}

interface MessageRow {
  id: string
  session_id: string | null
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

function rowToRecord(row: SessionRow, projectPath: string): SessionRecord {
  const providerId = row.provider_id ?? inferLegacyProviderId(row)
  const harnessId = providerId.startsWith('codex') ? 'codex' : 'claude'
  return {
    id: row.id,
    projectPath,
    projectId: row.project_id,
    providerId,
    harnessId,
    providerSessionId: row.provider_session_id,
    title: row.title,
    isWorktree: !!row.is_worktree,
    gitBranch: row.git_branch,
    worktreePath: row.worktree_path,
    isPinned: !!row.is_pinned,
    isHidden: !!row.is_hidden,
    totalCostUsd: row.total_cost_usd ?? 0,
    contextTokens: row.context_tokens ?? 0,
    createdAt: row.created_at,
    lastUserMessageAt: row.last_user_message_at,
  }
}

function inferLegacyProviderId(row: SessionRow): string {
  if (row.provider === 'codex') return 'codex-official'
  if (row.claude_session_id?.startsWith('codex_local_')) return 'codex-official'
  return 'claude-official'
}

export interface InsertSessionInput {
  id: string
  projectPath: string
  providerId: string
  title?: string | null
  isWorktree?: boolean
  gitBranch?: string | null
  worktreePath?: string | null
}

export function insertSessionRecord(input: InsertSessionInput): void {
  const projectId = getProjectId(input.projectPath)
  if (!projectId) throw new Error(`Project not found for path: ${input.projectPath}`)
  const now = new Date().toISOString()
  const legacyProvider = input.providerId.startsWith('codex') ? 'codex' : 'claude'
  getDb().prepare(`
    INSERT INTO sessions (
      id, project_id, provider_id, provider, title, created_at, last_user_message_at,
      is_worktree, git_branch, worktree_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    projectId,
    input.providerId,
    legacyProvider,
    input.title ?? null,
    now,
    now,
    input.isWorktree ? 1 : 0,
    input.gitBranch ?? null,
    input.worktreePath ?? null,
  )
}

export function getSessionRecord(sid: string): SessionRecord | null {
  const row = getDb().prepare(`
    SELECT s.*, p.path AS project_path
    FROM sessions s
    JOIN projects p ON p.id = s.project_id
    WHERE s.id = ?
  `).get(sid) as (SessionRow & { project_path: string }) | undefined
  if (!row) return null
  return rowToRecord(row, row.project_path)
}

export function listSessionRecordsByProject(projectPath: string): SessionRecord[] {
  const projectId = getProjectId(projectPath)
  if (!projectId) return []
  const rows = getDb().prepare(`
    SELECT *
    FROM sessions
    WHERE project_id = ?
    ORDER BY COALESCE(last_user_message_at, created_at) DESC
  `).all(projectId) as SessionRow[]
  return rows.map((r) => rowToRecord(r, projectPath))
}

export function updateProviderSessionId(sid: string, providerSessionId: string): void {
  getDb().prepare('UPDATE sessions SET provider_session_id = ? WHERE id = ?').run(providerSessionId, sid)
}

export function updateSessionTitle(sid: string, title: string): void {
  getDb().prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sid)
}

export function deleteSessionRecord(sid: string): void {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sid)
}

export interface SaveSessionStateInput {
  sid: string
  messages: ChatMessage[]
  totalCostUsd: number
  contextTokens: number
  title?: string
}

export function saveSessionStateBySid(input: SaveSessionStateInput): void {
  const db = getDb()
  const lastUserMessageAt = [...input.messages].reverse().find((m) => m.role === 'user')?.createdAt ?? null

  const upsertMsg = db.prepare(`
    INSERT INTO chat_messages (id, session_id, claude_session_id, sort_order, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id)
    VALUES (?, ?, (SELECT claude_session_id FROM sessions WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      content_json = excluded.content_json,
      metadata_json = excluded.metadata_json,
      checkpoint_id = excluded.checkpoint_id,
      resume_point_id = excluded.resume_point_id,
      session_id = COALESCE(excluded.session_id, session_id)
  `)

  const updateSession = input.title
    ? db.prepare(`
        UPDATE sessions
        SET total_cost_usd = ?, context_tokens = ?,
            last_user_message_at = COALESCE(?, last_user_message_at, created_at),
            title = CASE WHEN title IS NULL OR title = '' THEN ? ELSE title END
        WHERE id = ?
      `)
    : db.prepare(`
        UPDATE sessions
        SET total_cost_usd = ?, context_tokens = ?,
            last_user_message_at = COALESCE(?, last_user_message_at, created_at)
        WHERE id = ?
      `)

  const deleteStale = db.prepare('DELETE FROM chat_messages WHERE session_id = ?')

  const tx = db.transaction(() => {
    deleteStale.run(input.sid)
    for (let i = 0; i < input.messages.length; i++) {
      const msg = input.messages[i]
      upsertMsg.run(
        msg.id,
        input.sid,
        input.sid,
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
    if (input.title) {
      updateSession.run(input.totalCostUsd, input.contextTokens, lastUserMessageAt, input.title, input.sid)
    } else {
      updateSession.run(input.totalCostUsd, input.contextTokens, lastUserMessageAt, input.sid)
    }
  })

  tx()
}

export interface LoadedSessionState {
  record: SessionRecord
  messages: ChatMessage[]
}

export function loadSessionStateBySid(sid: string): LoadedSessionState | null {
  const record = getSessionRecord(sid)
  if (!record) return null

  const rows = getDb().prepare(`
    SELECT id, session_id, sort_order, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY sort_order ASC
  `).all(sid) as MessageRow[]

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

  return { record, messages }
}
