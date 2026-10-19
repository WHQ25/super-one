import { getDb } from './database'
import { deriveHarnessId } from './session/session-repo'
import { parseTagsJson } from '@superone/shared/session-tags'
import type { HarnessId, SessionRemoteControllerInfo } from '@superone/shared/agent-types'

/**
 * Sessions another device started on this host through the node surface
 * (`sessions.remote_controller_json`). The column holds who controls the
 * session and the launch settings a cold resume must restore; the session row
 * and transcript stay the ordinary desktop ones.
 */
export interface RemoteControllerRecord {
  /** Node pairing identity of the controller (the Host Action / lease holder). */
  clientSessionId: string
  /** Pairing label of the controlling device. */
  label: string | null
  permissionMode?: string | null
  sandboxMode?: string | null
  model?: string | null
  effort?: string | null
  mode?: string | null
  agentPreset?: string | null
  additionalDirectories?: string[] | null
  /** Credential id on this desktop the session runs on; absent follows the binding. */
  apiProviderId?: string | null
  systemPromptAppend?: string | null
  /** Collaboration parent on the controller; its mailbox tools run there as Host Actions. */
  externalParent?: { sessionId: string } | null
  /** This desktop took the session back; the controller watches until it reclaims it. */
  released?: boolean
}

/** A desktop session row as the node surfaces read it; `controller` when another device started it here. */
export interface DesktopSessionRow {
  sessionId: string
  projectId: string
  projectPath: string
  title: string | null
  harnessId: HarnessId
  providerId: string | null
  apiProviderId?: string | null
  providerSessionId: string | null
  worktreePath: string | null
  isWorktree?: boolean
  gitBranch?: string | null
  contextTokens?: number
  totalCostUsd?: number
  isPinned: boolean
  isHidden: boolean
  isUserRenamed: boolean
  tags: string[]
  createdAt: number
  updatedAt: number
  controller: RemoteControllerRecord | null
  /** Spawn parent on this host. Omitted for roots and mailbox endpoints. */
  parentSessionId?: string | null
}

/** A session another device started here through the node surface. */
export type RemoteControlledSessionRow = DesktopSessionRow & { controller: RemoteControllerRecord }

/** The renderer-facing part of a stored controller; null when the column is unset or unreadable. */
export function remoteControllerInfo(json: string | null | undefined): SessionRemoteControllerInfo | null {
  const record = parseRemoteController(json)
  return record ? { label: record.label, ...(record.released ? { released: true } : {}) } : null
}

export function parseRemoteController(json: string | null | undefined): RemoteControllerRecord | null {
  if (!json) return null
  try {
    const value = JSON.parse(json) as Partial<RemoteControllerRecord> | null
    if (!value || typeof value.clientSessionId !== 'string' || !value.clientSessionId) return null
    return { ...value, clientSessionId: value.clientSessionId, label: typeof value.label === 'string' ? value.label : null }
  } catch {
    return null
  }
}

/** Mark (or update) a session as controlled from another device; stamps its provider for list rows. */
export function setSessionRemoteController(sessionId: string, controller: RemoteControllerRecord, providerId?: string): boolean {
  return getDb()
    .prepare('UPDATE sessions SET remote_controller_json = ?, provider_id = COALESCE(provider_id, ?) WHERE id = ?')
    .run(JSON.stringify(controller), providerId ?? null, sessionId).changes > 0
}

const SESSION_COLUMNS = `
  s.id, s.project_id, p.path AS project_path, s.title, s.provider, s.provider_id, s.api_provider_id, s.provider_session_id,
  s.worktree_path, s.is_worktree, s.git_branch, s.context_tokens, s.total_cost_usd,
  s.is_pinned, s.is_hidden, s.is_user_renamed, s.tags_json, s.created_at,
  COALESCE(s.last_user_message_at, s.created_at) AS updated_at, s.remote_controller_json`

/**
 * Spawn grants only. A child that lives on another machine keeps a row here as
 * its mailbox (`config_json.remote.environmentId`); that grant is not a parent
 * the sidebar should nest.
 */
const SPAWN_PARENT_JOIN = `
  LEFT JOIN session_collaboration_grants g
    ON g.child_session_id = s.id
    AND COALESCE(g.kind, 'spawn') = 'spawn'
    AND json_extract(g.config_json, '$.remote.environmentId') IS NULL`

const SELECT = `
  SELECT ${SESSION_COLUMNS}, g.parent_session_id
  FROM sessions s JOIN projects p ON p.id = s.project_id
  ${SPAWN_PARENT_JOIN}`

interface Row {
  id: string
  project_id: string
  project_path: string
  title: string | null
  provider: string | null
  provider_id: string | null
  api_provider_id: string | null
  provider_session_id: string | null
  worktree_path: string | null
  is_worktree: number | null
  git_branch: string | null
  context_tokens: number | null
  total_cost_usd: number | null
  is_pinned: number | null
  is_hidden: number | null
  is_user_renamed: number | null
  tags_json: string | null
  created_at: string
  updated_at: string
  remote_controller_json: string | null
  parent_session_id?: string | null
}

function toRow(r: Row): DesktopSessionRow {
  return {
    sessionId: r.id,
    projectId: r.project_id,
    projectPath: r.project_path,
    title: r.title,
    harnessId: deriveHarnessId(r),
    providerId: r.provider_id,
    apiProviderId: r.api_provider_id,
    providerSessionId: r.provider_session_id,
    worktreePath: r.worktree_path,
    isWorktree: !!r.is_worktree,
    gitBranch: r.git_branch,
    contextTokens: r.context_tokens ?? 0,
    totalCostUsd: r.total_cost_usd ?? 0,
    isPinned: !!r.is_pinned,
    isHidden: !!r.is_hidden,
    isUserRenamed: !!r.is_user_renamed,
    tags: parseTagsJson(r.tags_json),
    createdAt: Date.parse(r.created_at) || 0,
    updatedAt: Date.parse(r.updated_at) || 0,
    controller: parseRemoteController(r.remote_controller_json),
    ...(r.parent_session_id ? { parentSessionId: r.parent_session_id } : {}),
  }
}

function controlled(row: DesktopSessionRow): row is RemoteControlledSessionRow {
  return row.controller !== null
}

/** Any session of this desktop, controlled or not. */
export function getDesktopSessionRow(sessionId: string): DesktopSessionRow | null {
  const row = getDb().prepare(`${SELECT} WHERE s.id = ?`).get(sessionId) as Row | undefined
  return row ? toRow(row) : null
}

/**
 * Every session of this desktop. Families stay together: a parent and its spawn
 * children share a page, ordered like the local sidebar list. Mailbox endpoints
 * for children on another machine are omitted. No projectId spans every project.
 */
export function listDesktopSessionRows(projectId?: string): DesktopSessionRow[] {
  const projectFilter = projectId ? 'AND s.project_id = ?' : ''
  const sql = `
    WITH related_sessions AS (
      SELECT ${SESSION_COLUMNS},
             g.parent_session_id,
             COALESCE(g.parent_session_id, s.id) AS root_session_id
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      ${SPAWN_PARENT_JOIN}
      WHERE NOT EXISTS (
        SELECT 1 FROM session_collaboration_grants mailbox
        WHERE mailbox.child_session_id = s.id
          AND COALESCE(mailbox.kind, 'spawn') = 'spawn'
          AND json_extract(mailbox.config_json, '$.remote.environmentId') IS NOT NULL
      )
      ${projectFilter}
    ),
    grouped_sessions AS (
      SELECT related_sessions.*,
             MAX(updated_at) OVER (PARTITION BY root_session_id) AS group_last_active_at
      FROM related_sessions
    )
    SELECT * FROM grouped_sessions
    ORDER BY group_last_active_at DESC,
             CASE WHEN parent_session_id IS NULL THEN 0 ELSE 1 END,
             updated_at DESC`
  const rows = (projectId
    ? getDb().prepare(sql).all(projectId)
    : getDb().prepare(sql).all()) as Row[]
  return rows.map(toRow)
}

export function getRemoteControlledSession(sessionId: string): RemoteControlledSessionRow | null {
  const row = getDesktopSessionRow(sessionId)
  return row && controlled(row) ? row : null
}
