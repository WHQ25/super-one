import Database from 'better-sqlite3'
import { join } from 'path'

const isDev = process.env.NODE_ENV === 'development'
let db: Database.Database | null = null
let insertStmt: Database.Statement | null = null

if (isDev) {
  db = new Database(join(process.cwd(), 'event-trace.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    DROP TABLE IF EXISTS events;
    CREATE TABLE events (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      ts     TEXT NOT NULL,
      source TEXT NOT NULL,
      type   TEXT NOT NULL,
      tag    TEXT,
      data   TEXT NOT NULL
    );
    CREATE INDEX idx_source ON events(source);
    CREATE INDEX idx_type ON events(type);
    CREATE INDEX idx_tag ON events(tag);
  `)
  insertStmt = db.prepare(
    'INSERT INTO events (ts, source, type, tag, data) VALUES (?, ?, ?, ?, ?)'
  )
}

export function trace(source: string, type: string, data: unknown, tag?: string): void {
  insertStmt?.run(
    new Date().toISOString().slice(11, 23),
    source,
    type,
    tag ?? null,
    JSON.stringify(data)
  )
}

export function closeTraceDb(): void {
  db?.close()
  db = null
  insertStmt = null
}
