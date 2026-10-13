import Database from 'better-sqlite3'

/** Consistent WAL-aware copy; the original database stays read-only. */
export function copyReadOnlySqlite(source: string, target: string): void {
  const db = new Database(source, { readonly: true, fileMustExist: true })
  try { db.prepare('VACUUM INTO ?').run(target) }
  finally { db.close() }
}
