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
  // Node-local AI provider credentials / bindings / custom platforms.
  ensureProviderTables(db)
  // Host Action channel tables + session controller binding columns.
  ensureHostActionSupport(db)

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

function ensureProviderTables(db: NodeDatabase): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  platform_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  name TEXT NOT NULL,
  secret TEXT NOT NULL DEFAULT '',
  secret_env TEXT NOT NULL DEFAULT '',
  overrides_json TEXT NOT NULL DEFAULT '{}',
  endpoints_json TEXT,
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS provider_bindings (
  consumer TEXT PRIMARY KEY NOT NULL,
  credential_id TEXT NOT NULL,
  endpoint_id TEXT,
  config_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS provider_custom_platforms (
  id TEXT PRIMARY KEY NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
`)
}

/**
 * Host Action channel: durable action rows + change log, and session binding columns.
 * Additive — schema generation stays at 1 (same pattern as harness/provider tables).
 */
function ensureHostActionSupport(db: NodeDatabase): void {
  const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('controller_client_session_id')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN controller_client_session_id TEXT`)
  }
  if (!names.has('host_action_capability_version')) {
    db.exec(
      `ALTER TABLE sessions ADD COLUMN host_action_capability_version INTEGER NOT NULL DEFAULT 0`,
    )
  }
  if (!names.has('host_action_tool_groups_json')) {
    db.exec(
      `ALTER TABLE sessions ADD COLUMN host_action_tool_groups_json TEXT NOT NULL DEFAULT '[]'`,
    )
  }

  db.exec(`
CREATE TABLE IF NOT EXISTS host_actions (
  action_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  controller_client_session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_group TEXT NOT NULL,
  args_json TEXT NOT NULL,
  replay_policy TEXT NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  claim_token_hash TEXT,
  claimed_at INTEGER,
  claim_expires_at INTEGER,
  result_json TEXT,
  error_json TEXT,
  response_payload_hash TEXT,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_host_actions_controller_state
  ON host_actions(controller_client_session_id, state);
CREATE INDEX IF NOT EXISTS idx_host_actions_session
  ON host_actions(session_id);

CREATE TABLE IF NOT EXISTS host_action_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  controller_client_session_id TEXT NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL,
  replay_policy TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_host_action_changes_controller_seq
  ON host_action_changes(controller_client_session_id, sequence);
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
