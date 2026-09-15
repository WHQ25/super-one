/**
 * The delivery record's DDL, on its own so a test fixture can open an empty
 * record without importing the desktop database
 * (`docs/design/session-sync-zone-delivery-record.md` §3).
 */
import type Database from 'better-sqlite3'

/** Phases in which the desktop copy is the only complete one, or is being made. */
export const CONTENT_OWNING_PHASES = "('writing', 'sealed', 'queued', 'uploading', 'committing')"

/**
 * The schema. Idempotent, so the migration and the tests share it and neither
 * can drift from the other. No FK to `sessions`: the session row is the
 * node's, not this database's.
 */
export function ensureSessionFileDeliveriesSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_file_deliveries (
      delivery_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      local_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      transfer_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      phase TEXT NOT NULL,
      outcome TEXT,
      holder TEXT,
      epoch INTEGER NOT NULL DEFAULT 0,
      offset INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error TEXT,
      gave_up_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deliveries_path
      ON session_file_deliveries(session_id, local_path);
    CREATE INDEX IF NOT EXISTS idx_deliveries_runnable
      ON session_file_deliveries(connection_id, phase, next_attempt_at)
      WHERE outcome IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_content_slot
      ON session_file_deliveries(session_id, local_path)
      WHERE outcome IS NULL AND phase IN ${CONTENT_OWNING_PHASES};
    CREATE TABLE IF NOT EXISTS session_zone_tombstones (
      session_id TEXT PRIMARY KEY,
      dropped_at TEXT NOT NULL
    );
  `)
}
