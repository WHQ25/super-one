/** Additive DDL only: database startup must not load Profile catalogs or harnesses. */
import type Database from 'better-sqlite3'

export function ensureAgentProfileApprovalSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_profile_approvals (
    profile_id TEXT PRIMARY KEY REFERENCES session_providers(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    approved_at INTEGER NOT NULL
  )`)
}
