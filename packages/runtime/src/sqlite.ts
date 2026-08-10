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
  /**
   * better-sqlite3 `transaction`: wraps `fn` so calling the returned function
   * runs it inside a transaction. Deliberately narrowed to the nullary form the
   * kernel uses — better-sqlite3 returns `Transaction<F>` (a superset of `F`),
   * which is assignable here, while a generic `(fn: T) => T` is not.
   */
  transaction?<R>(fn: () => R): () => R
}

/** Narrowed handle for stores that require transactional writes (harness catalog). */
export interface TransactionalSqliteDatabase extends SqliteDatabase {
  transaction<R>(fn: () => R): () => R
}
