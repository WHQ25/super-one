/**
 * SQLite-backed drafts table — unsent composer input, scoped to one environment.
 *
 * Shared by the desktop (local environment) and the node (remote environment):
 * both hosts open this store over their own database, so a draft always lives
 * on the machine its target project lives on. The row carries no connection id
 * because the storage location already encodes the environment.
 */

import {
  DRAFT_ATTACHMENTS_MAX_BYTES,
  type DraftAttachment,
  type DraftRecord,
  type DraftSessionSettings,
  type DraftUpsertRequest,
} from '@superone/shared/environment'
import type { HarnessId } from '@superone/shared/session-types'
import type { SqliteDatabase } from '../sqlite'

interface DbDraftRow {
  id: string
  title: string
  text: string
  doc_json: string | null
  attachments_json: string | null
  project_path: string | null
  harness: string | null
  model: string | null
  permission_mode: string | null
  settings_json: string | null
  origin_session_id: string | null
  created_at: string
  updated_at: string
}

/**
 * DDL shared by both hosts. `idx_drafts_origin` is partial so drafts with no
 * origin session (a bare idea, or one already handed to a session) never
 * collide, while a given unsent session can only ever own one draft.
 */
export const DRAFTS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  doc_json TEXT,
  attachments_json TEXT,
  project_path TEXT,
  harness TEXT,
  model TEXT,
  permission_mode TEXT,
  settings_json TEXT,
  origin_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drafts_updated ON drafts(updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_origin
  ON drafts(origin_session_id) WHERE origin_session_id IS NOT NULL;
`

function tableHasColumn(
  db: SqliteDatabase & { exec?: (sql: string) => void },
  table: string,
  column: string,
): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return rows.some((r) => r.name === column)
  } catch {
    return false
  }
}

export function ensureDraftsTable(db: SqliteDatabase & { exec?: (sql: string) => void }): void {
  if (typeof db.exec === 'function') {
    db.exec(DRAFTS_TABLE_DDL)
  } else {
    for (const stmt of DRAFTS_TABLE_DDL.split(';').map((s) => s.trim()).filter(Boolean)) {
      db.prepare(stmt).run()
    }
  }
  // Rows created before settings_json existed still load; backfill the column.
  if (!tableHasColumn(db, 'drafts', 'settings_json')) {
    db.prepare('ALTER TABLE drafts ADD COLUMN settings_json TEXT').run()
  }
}

/** First non-blank line, trimmed and clamped for list rendering. */
export function deriveDraftTitle(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  return line.length > 120 ? `${line.slice(0, 120)}…` : line
}

/**
 * Attachments ride inline as base64, so an oversized set would bloat every
 * list response. Drop the whole set rather than rejecting the write — losing
 * an image is recoverable, losing the typed text is not.
 */
function clampAttachments(attachments: DraftAttachment[] | undefined): DraftAttachment[] {
  if (!attachments?.length) return []
  const total = attachments.reduce((sum, a) => sum + a.data.length, 0)
  return total > DRAFT_ATTACHMENTS_MAX_BYTES ? [] : attachments
}

function parseSettings(raw: string | null | undefined): DraftSessionSettings {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as DraftSessionSettings) : {}
  } catch {
    return {}
  }
}

/** Merge denormalized columns into settings for rows written before settings_json. */
function coalesceSettings(row: DbDraftRow): DraftSessionSettings {
  const fromJson = parseSettings(row.settings_json)
  return {
    harness: (row.harness as HarnessId | null) ?? null,
    model: row.model ?? null,
    permissionMode: row.permission_mode ?? null,
    // JSON wins when present (newer full snapshot).
    ...fromJson,
  }
}

function toRecord(row: DbDraftRow): DraftRecord {
  const settings = coalesceSettings(row)
  return {
    id: row.id,
    title: row.title,
    text: row.text,
    docJson: row.doc_json ? (JSON.parse(row.doc_json) as object) : null,
    attachments: row.attachments_json ? (JSON.parse(row.attachments_json) as DraftAttachment[]) : [],
    projectPath: row.project_path,
    harness: (settings.harness as HarnessId | null | undefined) ?? (row.harness as HarnessId | null) ?? null,
    model: settings.model ?? row.model ?? null,
    permissionMode: settings.permissionMode ?? row.permission_mode ?? null,
    settings,
    originSessionId: row.origin_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Pick denormalized columns from settings + explicit request fields. */
function denormalize(input: DraftUpsertRequest): {
  harness: string | null
  model: string | null
  permissionMode: string | null
  settings: DraftSessionSettings
} {
  const settings: DraftSessionSettings = { ...(input.settings ?? {}) }
  if (input.harness !== undefined) settings.harness = input.harness
  if (input.model !== undefined) settings.model = input.model
  if (input.permissionMode !== undefined) settings.permissionMode = input.permissionMode

  const harness = settings.harness ?? null
  // Active model for list chips: codex uses codexModel, others use model.
  const model =
    harness === 'codex'
      ? (settings.codexModel ?? settings.model ?? null)
      : (settings.model ?? settings.codexModel ?? null)
  const permissionMode = settings.permissionMode ?? null
  return { harness, model, permissionMode, settings }
}

export interface DraftStore {
  /** Newest first; pass a project path to scope the list. */
  list(projectPath?: string): DraftRecord[]
  get(id: string): DraftRecord | undefined
  upsert(input: DraftUpsertRequest): DraftRecord
  delete(id: string): boolean
}

export function createDraftStore(db: SqliteDatabase & { exec?: (sql: string) => void }): DraftStore {
  ensureDraftsTable(db)

  const selectOne = db.prepare('SELECT * FROM drafts WHERE id = ?')
  const selectAll = db.prepare('SELECT * FROM drafts ORDER BY updated_at DESC, id DESC')
  const selectByProject = db.prepare(
    'SELECT * FROM drafts WHERE project_path = ? ORDER BY updated_at DESC, id DESC',
  )
  const deleteOtherOwners = db.prepare(
    'DELETE FROM drafts WHERE origin_session_id = ? AND id <> ?',
  )
  const deleteOne = db.prepare('DELETE FROM drafts WHERE id = ?')
  const upsertOne = db.prepare(`
INSERT INTO drafts (
  id, title, text, doc_json, attachments_json, project_path,
  harness, model, permission_mode, settings_json, origin_session_id, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  text = excluded.text,
  doc_json = excluded.doc_json,
  attachments_json = excluded.attachments_json,
  project_path = excluded.project_path,
  harness = excluded.harness,
  model = excluded.model,
  permission_mode = excluded.permission_mode,
  settings_json = excluded.settings_json,
  origin_session_id = excluded.origin_session_id,
  updated_at = excluded.updated_at
`)

  const get = (id: string): DraftRecord | undefined => {
    const row = selectOne.get(id) as DbDraftRow | undefined
    return row ? toRecord(row) : undefined
  }

  return {
    list(projectPath?: string) {
      const rows = (
        projectPath === undefined ? selectAll.all() : selectByProject.all(projectPath)
      ) as DbDraftRow[]
      return rows.map(toRecord)
    },

    get,

    upsert(input) {
      const now = new Date().toISOString()
      const existing = get(input.id)
      const attachments = clampAttachments(input.attachments)
      const originSessionId = input.originSessionId ?? null
      const { harness, model, permissionMode, settings } = denormalize(input)
      // Replace, don't accumulate: a second draft id claiming the same unsent
      // session means the controller lost its session→draft mapping (reload,
      // crash), and the older row is a staler snapshot of the same composer.
      if (originSessionId) deleteOtherOwners.run(originSessionId, input.id)
      upsertOne.run(
        input.id,
        deriveDraftTitle(input.text),
        input.text,
        input.docJson ? JSON.stringify(input.docJson) : null,
        attachments.length ? JSON.stringify(attachments) : null,
        input.projectPath ?? null,
        harness,
        model,
        permissionMode,
        Object.keys(settings).length ? JSON.stringify(settings) : null,
        originSessionId,
        existing?.createdAt ?? input.createdAt ?? now,
        now,
      )
      return get(input.id)!
    },

    delete(id) {
      return deleteOne.run(id).changes > 0
    },
  }
}
