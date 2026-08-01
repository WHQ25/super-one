import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SCHEMA_GENERATION, SCHEMA_SQL } from './schema'

export type NodeDatabase = Database.Database

export function openNodeDatabase(dbPath: string): NodeDatabase {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  // Additive session UI flags (pin/hide) — compatible with schema generation 1 handshake.
  ensureSessionUiColumns(db)
  // Additive harness catalog — compatible with schema generation 1 handshake.
  ensureHarnessInstallationsTable(db)

  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_generation') as
    | { value: string }
    | undefined
  if (!row) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_generation', String(SCHEMA_GENERATION))
  } else if (Number(row.value) > SCHEMA_GENERATION) {
    db.close()
    throw new Error(
      `database schema generation ${row.value} is newer than this binary (${SCHEMA_GENERATION}); upgrade the node binary`,
    )
  } else if (Number(row.value) < SCHEMA_GENERATION) {
    // Phase 1: only generation 1 exists; future migrations go here.
    db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(String(SCHEMA_GENERATION), 'schema_generation')
  }

  return db
}

function ensureSessionUiColumns(db: NodeDatabase): void {
  const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('is_pinned')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0`)
  }
  if (!names.has('is_hidden')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0`)
  }
  if (!names.has('cwd')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN cwd TEXT`)
  }
}

function ensureHarnessInstallationsTable(db: NodeDatabase): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS harness_installations (
  harness_id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'disabled',
  runtime_version TEXT,
  command TEXT,
  config_json TEXT,
  secret_ref TEXT,
  diagnostic_code TEXT,
  diagnostic_message TEXT,
  last_probed_at INTEGER,
  updated_at INTEGER NOT NULL
);
`)
}

export function getMeta(db: NodeDatabase, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(db: NodeDatabase, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}
