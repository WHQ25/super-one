import Database from 'better-sqlite3'

/** Opens someone else's SQLite file read-only. */
export interface ReadOnlyDatabase {
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] }
  close(): void
}

export type OpenReadOnlyDatabase = (path: string) => ReadOnlyDatabase

export const openReadOnlySqlite: OpenReadOnlyDatabase = (path) => new Database(path, { readonly: true, fileMustExist: true })

export function withDatabase<T>(open: OpenReadOnlyDatabase, path: string, read: (db: ReadOnlyDatabase) => T): T {
  const db = open(path)
  try {
    return read(db)
  } finally {
    db.close()
  }
}

export function hasTable(db: ReadOnlyDatabase, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined
}
