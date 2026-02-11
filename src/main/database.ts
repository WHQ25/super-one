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
      added_at TEXT NOT NULL,
      last_opened_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      claude_session_id TEXT UNIQUE,
      title TEXT,
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at);
  `)

  // Migration: add session cost/token columns
  const columns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
  if (!columns.some((c) => c.name === 'total_cost_usd')) {
    db.exec('ALTER TABLE sessions ADD COLUMN total_cost_usd REAL DEFAULT 0')
    db.exec('ALTER TABLE sessions ADD COLUMN context_tokens INTEGER DEFAULT 0')
  }

  // Migration: drop messages_json if it exists (moved to chat_messages table)
  if (columns.some((c) => c.name === 'messages_json')) {
    // SQLite doesn't support DROP COLUMN before 3.35.0; recreate table
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        claude_session_id TEXT UNIQUE,
        title TEXT,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        total_cost_usd REAL DEFAULT 0,
        context_tokens INTEGER DEFAULT 0
      );
      INSERT OR IGNORE INTO sessions_new (id, project_id, claude_session_id, title, created_at, last_active_at, total_cost_usd, context_tokens)
        SELECT id, project_id, claude_session_id, title, created_at, last_active_at, COALESCE(total_cost_usd, 0), COALESCE(context_tokens, 0)
        FROM sessions;
      DROP TABLE sessions;
      ALTER TABLE sessions_new RENAME TO sessions;
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at);
    `)
  }

  // chat_messages table: one row per message
  db.exec(`
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
  `)
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
