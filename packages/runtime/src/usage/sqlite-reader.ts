/** Opens someone else's SQLite file read-only. Hosts pass their own driver (desktop and CLI build better-sqlite3 differently). */
export interface ReadOnlyDatabase {
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] }
  close(): void
}

export type OpenReadOnlyDatabase = (path: string) => ReadOnlyDatabase

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
