import type Database from 'better-sqlite3'
import { getDb } from './database'
import { projectPathOfSession, sessionExists } from './db-sessions'
import { notifySessionList } from './session-list-watch'
import log from './logger'
import type { ScheduledSend, ScheduledSendPatch, ScheduledSendRemoteTurn, ScheduledSendSource } from '@superone/shared/agent-types'

/**
 * Persistence for the composer's scheduled send — at most one per session.
 *
 * `armed = 0` is an offer on screen that nothing owes yet; `armed = 1` means the
 * scheduler owes this session a send at `send_at`. Both states are persisted
 * because the case this exists for — waiting out a rate-limit window — is
 * routinely measured in hours, far longer than one app run, so an in-memory
 * timer would silently never fire.
 *
 * A remote-node session has no local `sessions` row, so the table carries no
 * foreign key: `remote_project_key` marks such a row, and a trigger stands in
 * for `ON DELETE CASCADE` on local ones.
 */

/**
 * The DDL lives here so the migration and the tests build the same table.
 *
 * Idempotent. Tables created before remote sessions declared
 * `session_id REFERENCES sessions(id) ON DELETE CASCADE`; that is loosened by a
 * constraint-only rebuild from the table's own stored DDL (same name, same
 * columns — architecture.md, "Schema changes"). Nothing references this table,
 * so the rebuild cascades nowhere whatever `foreign_keys` is set to.
 */
export function ensureScheduledSendsSchema(
  db: Database.Database,
  { warn = console.warn }: { warn?: (message: string) => void } = {},
): void {
  db.exec(`
    -- At most one queued send per session. armed = 0 is an offer the composer
    -- shows but nothing owes; armed = 1 is what the scheduler polls for and
    -- delivers at send_at. The source column decides the lifetime: a rate-limit
    -- row is scoped to the stall that created it, a manual one lives until
    -- delivered or cleared.
    CREATE TABLE IF NOT EXISTS scheduled_sends (
      session_id TEXT PRIMARY KEY,
      send_at TEXT NOT NULL,
      message TEXT,
      armed INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      remote_project_key TEXT,
      remote_turn_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_sends_due
      ON scheduled_sends(armed, send_at);
  `)
  const cols = db.prepare('PRAGMA table_info(scheduled_sends)').all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'remote_project_key')) {
    db.exec('ALTER TABLE scheduled_sends ADD COLUMN remote_project_key TEXT')
  }
  if (!cols.some((c) => c.name === 'remote_turn_json')) {
    db.exec('ALTER TABLE scheduled_sends ADD COLUMN remote_turn_json TEXT')
  }
  loosenSessionForeignKey(db, warn)
  // Stands in for the cascade on local rows. Created after the rebuild: a
  // trigger naming a table mid-rebuild would fail the rename.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS scheduled_sends_session_deleted
      AFTER DELETE ON sessions
      BEGIN DELETE FROM scheduled_sends WHERE session_id = OLD.id; END;
  `)
}

const REBUILT_TABLE = 'scheduled_sends_rebuild'

function loosenSessionForeignKey(db: Database.Database, warn: (message: string) => void): void {
  const keys = db.prepare('PRAGMA foreign_key_list(scheduled_sends)').all()
  if (keys.length === 0) return
  const { sql } = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'scheduled_sends'`)
    .get() as { sql: string }
  const loosened = sql.replace(/\s+REFERENCES\s+sessions\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE\b/i, '')
  const renamed = loosened.replace(
    /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?scheduled_sends["`]?/i,
    `CREATE TABLE ${REBUILT_TABLE}`,
  )
  if (loosened === sql || renamed === loosened) {
    // Remote-node sessions cannot queue sends on this database; local ones are unaffected.
    warn('[scheduled-send] scheduled_sends: unrecognized session_id foreign key DDL; keeping it')
    return
  }
  const indexes = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'scheduled_sends' AND sql IS NOT NULL
  `).all() as Array<{ sql: string }>
  db.exec(renamed)
  db.exec(`INSERT INTO ${REBUILT_TABLE} SELECT * FROM scheduled_sends`)
  // Same columns, looser constraint: a build that predates this reads the
  // rebuilt table exactly as before (see database-migrations-policy.test.ts).
  db.exec('DROP TABLE scheduled_sends')
  db.exec(`ALTER TABLE ${REBUILT_TABLE} RENAME TO scheduled_sends`)
  for (const index of indexes) db.exec(index.sql)
}

interface DbScheduledSend {
  session_id: string
  send_at: string
  message: string | null
  armed: number
  source: string
  created_at: string
  remote_project_key: string | null
  remote_turn_json: string | null
}

/** Where a remote-node session's queued send goes, and what it carries. */
export interface ScheduledSendRemoteTarget {
  projectKey: string
  turn: ScheduledSendRemoteTurn | null
}

function toScheduledSend(row: DbScheduledSend): ScheduledSend {
  return {
    sessionId: row.session_id,
    sendAt: Date.parse(row.send_at),
    message: row.message,
    armed: row.armed === 1,
    source: row.source === 'rate_limit' ? 'rate_limit' : 'manual',
  }
}

function getRow(sessionId: string): DbScheduledSend | undefined {
  return getDb()
    .prepare('SELECT * FROM scheduled_sends WHERE session_id = ?')
    .get(sessionId) as DbScheduledSend | undefined
}

export function getScheduledSend(sessionId: string): ScheduledSend | null {
  const row = getRow(sessionId)
  return row ? toScheduledSend(row) : null
}

/** Null for a local session. */
export function getScheduledSendRemoteTarget(sessionId: string): ScheduledSendRemoteTarget | null {
  const row = getRow(sessionId)
  if (!row?.remote_project_key) return null
  let turn: ScheduledSendRemoteTurn | null = null
  try {
    turn = row.remote_turn_json ? JSON.parse(row.remote_turn_json) as ScheduledSendRemoteTurn : null
  } catch {
    log.warn('[scheduled-send] unreadable remote turn sid=%s', sessionId)
  }
  return { projectKey: row.remote_project_key, turn }
}

/**
 * Every queued send, for the sidebar.
 *
 * The list is one row per session and only grows with things the user armed by
 * hand or was offered, so there is nothing to paginate — the renderer keeps the
 * whole set and the change broadcast keeps it current.
 */
export function listScheduledSends(): ScheduledSend[] {
  const rows = getDb()
    .prepare('SELECT * FROM scheduled_sends ORDER BY send_at ASC')
    .all() as DbScheduledSend[]
  return rows.map(toScheduledSend)
}

/** Armed rows whose `send_at` has passed. */
export function listDueScheduledSends(nowMs: number): ScheduledSend[] {
  const rows = getDb()
    .prepare('SELECT * FROM scheduled_sends WHERE armed = 1 AND send_at <= ?')
    .all(new Date(nowMs).toISOString()) as DbScheduledSend[]
  return rows.map(toScheduledSend)
}

/**
 * Create or amend the session's scheduled send.
 *
 * Omitted fields keep their stored value, which is what lets the composer flip
 * `armed` without restating the time and re-time a queued message without
 * restating its text. Creating a row needs `sendAt` — there is nothing sensible
 * to schedule against otherwise, and inventing one would fire at a time nobody
 * chose.
 *
 * `remote` marks a remote-node session on the row's first write (the key never
 * changes after) and refreshes its turn options on any write that has them.
 */
export function upsertScheduledSend(
  sessionId: string,
  patch: ScheduledSendPatch,
  remote?: { projectKey: string; turn?: ScheduledSendRemoteTurn },
): ScheduledSend | null {
  const prevRow = getRow(sessionId)
  const prev = prevRow ? toScheduledSend(prevRow) : null
  const sendAt = patch.sendAt ?? prev?.sendAt
  if (sendAt === undefined) return null
  const remoteProjectKey = prevRow?.remote_project_key ?? remote?.projectKey ?? null
  // A local schedule hangs off the session's row — delivery resumes it from
  // there. A never-messaged session has none yet, so there is nothing to queue.
  if (!remoteProjectKey && !prevRow && !sessionExists(sessionId)) return null
  const remoteTurnJson = remote?.turn ? JSON.stringify(remote.turn) : (prevRow?.remote_turn_json ?? null)

  const message = patch.message === undefined ? (prev?.message ?? null) : (patch.message?.trim() || null)
  const armed = patch.armed ?? prev?.armed ?? false
  const source: ScheduledSendSource = patch.source ?? prev?.source ?? 'manual'

  try {
    getDb()
      .prepare(`
        INSERT INTO scheduled_sends (session_id, send_at, message, armed, source, created_at, remote_project_key, remote_turn_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          send_at = excluded.send_at,
          message = excluded.message,
          armed = excluded.armed,
          source = excluded.source,
          remote_turn_json = excluded.remote_turn_json
      `)
      .run(
        sessionId,
        new Date(sendAt).toISOString(),
        message,
        armed ? 1 : 0,
        source,
        // Only read on insert — the conflict branch deliberately leaves it alone.
        new Date().toISOString(),
        remoteProjectKey,
        remoteTurnJson,
      )
  } catch (err) {
    log.warn('[scheduled-send] upsert failed sid=%s: %s', sessionId, String(err))
    return null
  }
  const next = getScheduledSend(sessionId)
  notifyScheduledListChange(sessionId, prev, next)
  return next
}

export function deleteScheduledSend(sessionId: string): void {
  const prev = getScheduledSend(sessionId)
  getDb().prepare('DELETE FROM scheduled_sends WHERE session_id = ?').run(sessionId)
  notifyScheduledListChange(sessionId, prev, null)
}

/** Drop only rows a stall created — a manual schedule outlives the turn it sat through. */
export function deleteScheduledSendBySource(sessionId: string, source: ScheduledSendSource): void {
  const prev = getScheduledSend(sessionId)
  getDb().prepare('DELETE FROM scheduled_sends WHERE session_id = ? AND source = ?').run(sessionId, source)
  if (prev?.source === source) notifyScheduledListChange(sessionId, prev, null)
}

/** Draft mirroring can write every second; only a visible time change rereads the list. */
function notifyScheduledListChange(sessionId: string, prev: ScheduledSend | null, next: ScheduledSend | null): void {
  const previousTime = prev?.armed ? prev.sendAt : null
  const nextTime = next?.armed ? next.sendAt : null
  if (previousTime !== nextTime) notifySessionList(projectPathOfSession(sessionId))
}
