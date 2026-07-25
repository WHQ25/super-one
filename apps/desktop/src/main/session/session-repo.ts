import { randomUUID } from 'node:crypto'
import { getDb } from '../database'
import log from '../logger'
import { getProjectId } from '../recent-folders'
import { recordSessionStarted, recordMessageCounts, type HarnessKind } from '../usage-stats-service'
import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import type { ChatMessage, ContentBlock, EffortLevel, ImageAttachment, ChatMessageContext } from '@superone/shared/agent-types'
import type { HarnessId, MessagePersistMode } from './types'

export function serializeMessageContent(msg: ChatMessage): string {
  return JSON.stringify({
    content: msg.content,
    ...(msg.attachments ? { attachments: msg.attachments } : {}),
    ...(msg.contexts ? { contexts: msg.contexts } : {}),
    ...(msg.userSelections ? { userSelections: msg.userSelections } : {}),
  })
}

export function parseMessageContent(json: string): {
  content: ContentBlock[]
  attachments?: ImageAttachment[]
  contexts?: ChatMessageContext[]
  userSelections?: string[]
} {
  const parsed = JSON.parse(json)
  if (Array.isArray(parsed)) return { content: parsed }
  return {
    content: parsed.content ?? [],
    attachments: parsed.attachments,
    contexts: parsed.contexts,
    userSelections: parsed.userSelections,
  }
}

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
  apiProviderId: string | null
  acpAgentId: string | null
  selectedModel: string | null
  selectedEffort: EffortLevel | null
}

function normalizeCodexThreadId(value: string | null | undefined): string | null {
  const threadId = value?.trim() || null
  if (threadId?.startsWith('codex_local_') || threadId?.startsWith('codex-remote-')) return null
  return threadId
}

export function resolveProviderSessionIdForResume(
  record: Pick<SessionRecord, 'harnessId' | 'providerSessionId'>,
  messages: readonly ChatMessage[],
): string | null {
  if (record.harnessId !== 'codex') return record.providerSessionId?.trim() || null

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant' || message.providerId !== 'codex') continue
    const threadId = normalizeCodexThreadId(message.metadata?.codex?.threadId)
    if (threadId) return threadId
  }

  return normalizeCodexThreadId(record.providerSessionId)
}

interface SessionRow {
  id: string
  project_id: string
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
  api_provider_id: string | null
  acp_agent_id: string | null
  selected_model: string | null
  selected_effort: string | null
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
  const harnessId = deriveHarnessId(row)
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
    apiProviderId: row.api_provider_id ?? null,
    acpAgentId: row.acp_agent_id ?? null,
    selectedModel: row.selected_model ?? null,
    selectedEffort: (row.selected_effort as EffortLevel | null) ?? null,
  }
}

function inferLegacyProviderId(row: { provider?: string | null }): string {
  if (row.provider === 'codex') return 'codex-base'
  if (row.provider === 'acp') return 'acp-base'
  if (row.provider === 'opencode') return 'opencode-base'
  if (row.provider === 'cursor') return 'cursor-base'
  return 'claude-base'
}

/** Map a session_providers id (or legacy base id) to its harness. */
export function harnessIdFromProviderId(providerId: string): HarnessId {
  if (providerId.startsWith('codex')) return 'codex'
  if (providerId.startsWith('acp')) return 'acp'
  if (providerId.startsWith('opencode')) return 'opencode'
  if (providerId.startsWith('cursor')) return 'cursor'
  return 'claude'
}

/**
 * Single authoritative harness derivation: structured `provider_id` wins;
 * fall back to the legacy `provider` string column; default claude only when
 * both are absent. Shared by session-repo and db-sessions so there is exactly
 * one place that maps a persisted row to a harness.
 */
export function deriveHarnessId(row: { provider_id?: string | null; provider?: string | null }): HarnessId {
  const providerId = row.provider_id ?? inferLegacyProviderId(row)
  return harnessIdFromProviderId(providerId)
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
  const legacyProvider = harnessIdFromProviderId(input.providerId)
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

export function listWorktreePaths(): string[] {
  const rows = getDb().prepare(`
    SELECT DISTINCT worktree_path
    FROM sessions
    WHERE worktree_path IS NOT NULL AND worktree_path != ''
  `).all() as Array<{ worktree_path: string }>
  return rows.map((r) => r.worktree_path)
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

/** @returns true when a sessions row was updated (false if the draft row does not exist yet). */
export function updateProviderSessionId(sid: string, providerSessionId: string): boolean {
  const result = getDb()
    .prepare('UPDATE sessions SET provider_session_id = ? WHERE id = ?')
    .run(providerSessionId, sid)
  return result.changes > 0
}

export function updateAcpAgentId(sid: string, acpAgentId: string | null): void {
  getDb().prepare('UPDATE sessions SET acp_agent_id = ? WHERE id = ?').run(acpAgentId, sid)
}

export function updateSessionTitle(sid: string, title: string): void {
  getDb().prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sid)
}

export function deleteSessionRecord(sid: string): void {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sid)
}

export interface SaveSessionStateInput {
  sid: string
  projectPath: string
  providerId: string
  messages: ChatMessage[]
  totalCostUsd: number
  contextTokens: number
  title?: string
  isWorktree?: boolean
  worktreePath?: string | null
  gitBranch?: string | null
  apiProviderId?: string | null
  acpAgentId?: string | null
  selectedModel?: string | null
  selectedEffort?: EffortLevel | null
  /**
   * Provider/agent session id for cold resume (Grok ACP session/load).
   * Written on insert and on conflict when non-null so draft→first-message
   * does not drop an id that was only known in memory during prewarm.
   */
  providerSessionId?: string | null
  /**
   * Defaults to `{ kind: 'full' }` so legacy callers remain correct.
   * Session always passes an explicit mode.
   */
  messagePersistMode?: MessagePersistMode
}

export function saveSessionStateBySid(input: SaveSessionStateInput): void {
  const db = getDb()
  const projectId = getProjectId(input.projectPath)
  if (!projectId) throw new Error(`Project not found for path: ${input.projectPath}`)
  const lastUserMessageAt = [...input.messages].reverse().find((m) => m.role === 'user')?.createdAt ?? null
  const legacyProvider = harnessIdFromProviderId(input.providerId)
  const now = new Date().toISOString()
  const persistMode: MessagePersistMode = input.messagePersistMode ?? { kind: 'full' }
  const providerSessionId = input.providerSessionId?.trim() || null

  const upsertSession = db.prepare(`
    INSERT INTO sessions (
      id, project_id, provider_id, provider, provider_session_id, title, created_at, last_user_message_at,
      is_worktree, git_branch, worktree_path, api_provider_id, acp_agent_id, selected_model, selected_effort
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider_id = excluded.provider_id,
      provider = excluded.provider,
      -- Same SuperOne sid can switch harness on an empty draft. When provider_id
      -- changes, do not COALESCE-keep the prior harness's provider session id
      -- (would resume Claude/Codex thread under Grok or vice versa on cold load).
      provider_session_id = CASE
        WHEN excluded.provider_id IS NOT sessions.provider_id THEN excluded.provider_session_id
        ELSE COALESCE(excluded.provider_session_id, sessions.provider_session_id)
      END,
      is_worktree = excluded.is_worktree,
      git_branch = excluded.git_branch,
      worktree_path = excluded.worktree_path,
      api_provider_id = excluded.api_provider_id,
      acp_agent_id = excluded.acp_agent_id,
      selected_model = excluded.selected_model,
      selected_effort = excluded.selected_effort
  `)

  const upsertMsg = db.prepare(`
    INSERT INTO chat_messages (id, session_id, sort_order, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id, usage_counted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      sort_order = excluded.sort_order,
      role = excluded.role,
      status = excluded.status,
      content_json = excluded.content_json,
      created_at = excluded.created_at,
      provider_id = excluded.provider_id,
      metadata_json = excluded.metadata_json,
      checkpoint_id = excluded.checkpoint_id,
      resume_point_id = excluded.resume_point_id,
      session_id = COALESCE(excluded.session_id, session_id),
      usage_counted_at = COALESCE(chat_messages.usage_counted_at, excluded.usage_counted_at)
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

  const deleteMsgById = db.prepare('DELETE FROM chat_messages WHERE session_id = ? AND id = ?')

  const harness: HarnessKind | null =
    legacyProvider === 'codex'
    || legacyProvider === 'claude'
    || legacyProvider === 'cursor'
    || legacyProvider === 'opencode'
      ? legacyProvider
      : legacyProvider === 'acp' && isGrokAcpAgent(input.acpAgentId)
        ? 'grok'
        : null
  const newlyCountedMessages: Array<{ role: string; createdAt: string }> = []
  let countSessionStarted = false
  let sessionCreatedAt = now

  const tx = db.transaction(() => {
    const sessionRow = db.prepare(`
      SELECT created_at, usage_counted_at FROM sessions WHERE id = ?
    `).get(input.sid) as { created_at: string; usage_counted_at: string | null } | undefined

    upsertSession.run(
      input.sid,
      projectId,
      input.providerId,
      legacyProvider,
      providerSessionId,
      input.title ?? null,
      now,
      lastUserMessageAt ?? now,
      input.isWorktree ? 1 : 0,
      input.gitBranch ?? null,
      input.worktreePath ?? null,
      input.apiProviderId ?? null,
      input.acpAgentId ?? null,
      input.selectedModel ?? null,
      input.selectedEffort ?? null,
    )
    sessionCreatedAt = sessionRow?.created_at ?? now

    const existingRows = db.prepare(`
      SELECT id, usage_counted_at FROM chat_messages WHERE session_id = ?
    `).all(input.sid) as Array<{ id: string; usage_counted_at: string | null }>
    const existingIds = new Set(existingRows.map((r) => r.id))
    const priorCountedIds = new Set(
      existingRows.filter((r) => r.usage_counted_at != null).map((r) => r.id),
    )

    const memoryIds = new Set(input.messages.map((m) => m.id))
    for (const id of existingIds) {
      if (!memoryIds.has(id)) deleteMsgById.run(input.sid, id)
    }

    const toWrite = new Set<string>()
    if (persistMode.kind === 'full') {
      for (const id of memoryIds) toWrite.add(id)
    } else {
      for (const id of persistMode.dirtyMessageIds) {
        if (memoryIds.has(id)) toWrite.add(id)
      }
      for (const id of memoryIds) {
        if (!existingIds.has(id)) toWrite.add(id)
      }
    }

    const indexById = new Map(input.messages.map((m, i) => [m.id, i]))
    for (const msg of input.messages) {
      if (!toWrite.has(msg.id)) continue
      const i = indexById.get(msg.id) ?? 0
      const isAssistantComplete = msg.role === 'assistant' && msg.status === 'complete'
      const isUser = msg.role === 'user'
      const wasAlreadyCounted = priorCountedIds.has(msg.id)
      const shouldCount = !wasAlreadyCounted && (isUser || isAssistantComplete)
      const usageCountedAt = wasAlreadyCounted || shouldCount ? now : null
      upsertMsg.run(
        msg.id,
        input.sid,
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
      if (shouldCount) newlyCountedMessages.push({ role: msg.role, createdAt: msg.createdAt })
    }

    if (input.title) {
      updateSession.run(input.totalCostUsd, input.contextTokens, lastUserMessageAt, input.title, input.sid)
    } else {
      updateSession.run(input.totalCostUsd, input.contextTokens, lastUserMessageAt, input.sid)
    }
    if (!sessionRow || !sessionRow.usage_counted_at) {
      db.prepare('UPDATE sessions SET usage_counted_at = ? WHERE id = ?').run(now, input.sid)
      countSessionStarted = true
    }
  })

  tx()

  // Activity stats are best-effort and must not fail the message persist
  // acknowledgement: usage_counted_at is already committed above, so a throw
  // here would leave dirty ids stuck while never re-counting those messages.
  if (harness) {
    try {
      if (countSessionStarted) {
        recordSessionStarted(harness, sessionCreatedAt)
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
    } catch (err) {
      // Best-effort only; message rows already committed. Do not rethrow —
      // Session would retain dirty ids while usage_counted_at is already set.
      log.warn('[session-repo] activity_daily update failed after message persist:', err)
    }
  }
}

export interface ForkSessionRecordInput {
  sourceId: string
  newId: string
  providerSessionId: string
  /** Worktree directory of the fork, or null for a local fork in the main repo. */
  worktreePath: string | null
  /** Branch of the forked worktree, or null when detached / a local fork. */
  gitBranch: string | null
  title: string
  /**
   * Truncate copied messages so the fork keeps everything up to AND including
   * this source-message id (matches the harness-level truncation of the
   * thread/jsonl). Omit for a full copy. If the id isn't found, falls back to a
   * full copy so SQLite never disagrees with the underlying transcript.
   */
  forkFromMessageId?: string
}

/**
 * Copy a session's row + messages into a new session id (session fork).
 *
 * - Messages get fresh ids — `chat_messages.id` is a global PK, so reusing the
 *   source ids would re-parent the source's rows on the next upsert.
 * - Every copied row (session + messages) is pre-stamped `usage_counted_at` so
 *   the fork never re-inflates usage stats with already-counted history.
 * - `checkpoint_id` / `resume_point_id` are dropped — a forked SDK session
 *   starts without file-history snapshots.
 */
export function forkSessionRecord(input: ForkSessionRecordInput): void {
  const db = getDb()
  const source = getSessionRecord(input.sourceId)
  if (!source) throw new Error(`Source session not found: ${input.sourceId}`)
  const now = new Date().toISOString()
  const legacyProvider = harnessIdFromProviderId(source.providerId)

  const allSrcMsgs = db.prepare(`
    SELECT id, role, status, content_json, created_at, provider_id, metadata_json
    FROM chat_messages WHERE session_id = ? ORDER BY sort_order ASC
  `).all(input.sourceId) as Array<Pick<MessageRow, 'id' | 'role' | 'status' | 'content_json' | 'created_at' | 'provider_id' | 'metadata_json'>>

  const cutIdx = input.forkFromMessageId
    ? allSrcMsgs.findIndex((m) => m.id === input.forkFromMessageId)
    : -1
  const srcMsgs = cutIdx >= 0 ? allSrcMsgs.slice(0, cutIdx + 1) : allSrcMsgs

  const lastUserAt = [...srcMsgs].reverse().find((m) => m.role === 'user')?.created_at ?? now

  const insSession = db.prepare(`
    INSERT INTO sessions (
      id, project_id, provider_id, provider, provider_session_id, title,
      created_at, last_user_message_at, total_cost_usd, context_tokens,
      is_worktree, git_branch, worktree_path, api_provider_id, acp_agent_id,
      selected_model, selected_effort, usage_counted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insMsg = db.prepare(`
    INSERT INTO chat_messages (id, session_id, sort_order, role, status, content_json, created_at, provider_id, metadata_json, usage_counted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  db.transaction(() => {
    insSession.run(
      input.newId, source.projectId, source.providerId, legacyProvider,
      input.providerSessionId, input.title, now, lastUserAt, source.contextTokens,
      input.worktreePath ? 1 : 0, input.gitBranch, input.worktreePath, source.apiProviderId,
      source.acpAgentId, source.selectedModel, source.selectedEffort, now,
    )
    srcMsgs.forEach((m, i) => {
      insMsg.run(
        randomUUID(), input.newId, i, m.role,
        m.status === 'streaming' ? 'interrupted' : m.status,
        m.content_json, m.created_at, m.provider_id, m.metadata_json, now,
      )
    })
  })()
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

  return { record, messages }
}
