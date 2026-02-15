import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'superone.db')
  db = new Database(dbPath)

  // Performance pragmas
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  migrate(db)

  return db
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      claude_session_id TEXT UNIQUE,
      title TEXT,
      created_at TEXT NOT NULL,
      total_cost_usd REAL DEFAULT 0,
      context_tokens INTEGER DEFAULT 0,
      provider TEXT DEFAULT 'claude'
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      claude_session_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      metadata_json TEXT,
      FOREIGN KEY (claude_session_id) REFERENCES sessions(claude_session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(claude_session_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_last_user ON chat_messages(claude_session_id, role, created_at);
  `)

  // Drop legacy init_cache table if it exists (data now fetched at app startup via connect-claude)
  db.exec('DROP TABLE IF EXISTS init_cache')

  // Add is_worktree and git_branch columns to sessions if missing
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'is_worktree')) {
    db.exec('ALTER TABLE sessions ADD COLUMN is_worktree INTEGER DEFAULT 0')
  }
  if (!cols.some((c) => c.name === 'git_branch')) {
    db.exec('ALTER TABLE sessions ADD COLUMN git_branch TEXT')
  }
  if (!cols.some((c) => c.name === 'is_pinned')) {
    db.exec('ALTER TABLE sessions ADD COLUMN is_pinned INTEGER DEFAULT 0')
  }
  if (!cols.some((c) => c.name === 'provider')) {
    db.exec("ALTER TABLE sessions ADD COLUMN provider TEXT DEFAULT 'claude'")
  }

  // Add checkpoint_id column to chat_messages if missing
  const msgCols = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>
  if (!msgCols.some((c) => c.name === 'checkpoint_id')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN checkpoint_id TEXT')
  }
  if (!msgCols.some((c) => c.name === 'resume_point_id')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN resume_point_id TEXT')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS global_resource_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      models_json TEXT NOT NULL,
      account_json TEXT NOT NULL,
      slash_commands_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

export function getCachedResources(): { models: unknown[]; account: Record<string, unknown>; slashCommands: unknown[] } | null {
  const row = getDb().prepare('SELECT models_json, account_json, slash_commands_json FROM global_resource_cache WHERE id = 1').get() as
    | { models_json: string; account_json: string; slash_commands_json: string }
    | undefined
  if (!row) return null
  return {
    models: JSON.parse(row.models_json),
    account: JSON.parse(row.account_json),
    slashCommands: JSON.parse(row.slash_commands_json),
  }
}

export function setCachedResources(models: unknown[], account: unknown, slashCommands: unknown[]): void {
  getDb().prepare(`
    INSERT INTO global_resource_cache (id, models_json, account_json, slash_commands_json, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      models_json = excluded.models_json,
      account_json = excluded.account_json,
      slash_commands_json = excluded.slash_commands_json,
      updated_at = excluded.updated_at
  `).run(
    JSON.stringify(models),
    JSON.stringify(account),
    JSON.stringify(slashCommands),
    new Date().toISOString(),
  )
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
