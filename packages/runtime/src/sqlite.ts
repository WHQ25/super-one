/**
 * Minimal better-sqlite3-compatible surface used by lease / event-log / session store.
 * Hosts pass their real Database instance (CLI uses better-sqlite3).
 */
export type SqlRunResult = { changes: number; lastInsertRowid: number | bigint }

export interface SqlStatement {
  run(...params: unknown[]): SqlRunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqliteDatabase {
  prepare(sql: string): SqlStatement
}
