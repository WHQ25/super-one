import type Database from 'better-sqlite3'
import { join } from 'path'

const isDev = process.env.NODE_ENV === 'development'
let db: Database.Database | null = null
let insertStmt: Database.Statement | null = null
let ready: Promise<void> | null = null

if (isDev) {
  ready = import('better-sqlite3')
    .then(({ default: Db }) => {
      db = new (Db as unknown as typeof Database)(
        process.env.SUPERONE_EVENT_TRACE_DB ?? join(process.cwd(), 'event-trace.db'),
      )
      db.pragma('journal_mode = WAL')
      db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        ts     TEXT NOT NULL,
        source TEXT NOT NULL,
        type   TEXT NOT NULL,
        tag    TEXT,
        data   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_source ON events(source);
      CREATE INDEX IF NOT EXISTS idx_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_tag ON events(tag);
    `);
      insertStmt = db.prepare(
        'INSERT INTO events (ts, source, type, tag, data) VALUES (?, ?, ?, ?, ?)',
      )
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `[event-trace] initialization failed: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    })
}

/**
 * A traced payload must stay cheap to write. Codex re-emits a command execution
 * item in full on every output delta, so one `rg` over a large tree becomes
 * thousands of multi-megabyte rows — enough to stall the main thread on these
 * synchronous inserts and exhaust the V8 heap. Long strings are capped during
 * serialization (the oversized value is never copied whole) and a row-level
 * backstop catches payloads that are large by breadth rather than by one field.
 */
const MAX_TRACE_STRING_CHARS = 16 * 1024
const MAX_TRACE_ROW_CHARS = 256 * 1024

function capString(value: string, limit: number): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}…[+${value.length - limit} chars truncated]`
}

/** Exported for tests: JSON for `events.data`, bounded and still parseable. */
export function serializeTraceData(data: unknown): string {
  const json = JSON.stringify(data, (_key, value: unknown) => (
    typeof value === 'string' ? capString(value, MAX_TRACE_STRING_CHARS) : value
  ))
  if (json === undefined) return 'null'
  if (json.length <= MAX_TRACE_ROW_CHARS) return json
  return JSON.stringify({
    truncated: true,
    chars: json.length,
    head: json.slice(0, MAX_TRACE_ROW_CHARS),
  })
}

export function trace(
  source: string,
  type: string,
  data: unknown,
  tag?: string,
): void {
  if (!insertStmt) return
  insertStmt.run(
    new Date().toISOString().slice(11, 23),
    source,
    type,
    tag ?? null,
    serializeTraceData(data),
  )
}

export function closeTraceDb(): void {
  db?.close()
  db = null
  insertStmt = null
}

export { ready as traceReady }
