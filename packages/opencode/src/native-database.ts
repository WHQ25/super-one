import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import Database from 'better-sqlite3'
import { copyReadOnlySqlite } from '@superone/runtime/fs/sqlite-backup'

/** One executor per native DB: OpenCode otherwise resumes siblings on startup. */
export function nativeDatabasePath(home: string, sessionId: string) {
  return join(home, 'databases', `${createHash('sha256').update(sessionId).digest('hex')}.db`)
}

function containsSession(path: string, id: string) {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='session_v2'").get()) return false
    return Boolean(db.prepare('SELECT 1 FROM session_v2 WHERE id = ?').get(id))
  } finally { db.close() }
}

/** Cold administration uses the newest owned copy, rather than a fork's stale shadow. */
export function findOwnedNativeDatabase(home: string, nativeId: string) {
  const directory = join(home, 'databases')
  if (!existsSync(directory)) return undefined
  const candidates = readdirSync(directory).filter(name => /^[a-f0-9]{64}\.db$/.test(name)).flatMap(name => {
    const path = join(directory, name), db = new Database(path, { readonly: true, fileMustExist: true })
    try {
      const row = db.prepare('SELECT time_updated FROM session_v2 WHERE id = ?').get(nativeId) as { time_updated: number } | undefined
      return row ? [{ path, updated: row.time_updated }] : []
    } finally { db.close() }
  })
  return candidates.sort((a, b) => b.updated - a.updated)[0]?.path
}

/** Only called while the caller owns this database and no service is healthy. */
export function interruptNativeDatabase(path: string) {
  if (!existsSync(path)) return
  const db = new Database(path)
  try {
    db.prepare(`UPDATE session_v2 SET time_idle = ?, idle_outcome = 'interrupted', time_suspended = NULL,
      resume_attempts = 0 WHERE time_suspended IS NOT NULL`).run(Date.now())
  } finally { db.close() }
}

/** Seed only credentials plus the requested conversation; never write to the source. */
export function prepareNativeDatabase(home: string, sessionId: string, env: Record<string, string>, nativeId?: string) {
  const target = nativeDatabasePath(home, sessionId), directory = join(home, 'databases')
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700)
  if (existsSync(target)) {
    if (nativeId && !containsSession(target, nativeId)) throw new Error('The owned OpenCode database does not contain this resume session')
    return target
  }
  const data = join(env.XDG_DATA_HOME ?? process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'opencode')
  const configured = env.OPENCODE_DB ?? process.env.OPENCODE_DB
  const originals = configured && configured !== ':memory:'
    ? [isAbsolute(configured) ? configured : join(data, configured)]
    : existsSync(data) ? readdirSync(data).filter(name => /^opencode(?:-[\w.-]+)?\.db$/.test(name)).map(name => join(data, name)) : []
  const caches = readdirSync(directory).filter(name => name.endsWith('.db')).map(name => join(directory, name))
  const sources = [...originals, ...caches].filter(path => path !== target && existsSync(path))
  const source = nativeId ? sources.find(path => containsSession(path, nativeId)) : originals.find(path => existsSync(path))
  if (!source) {
    if (nativeId) throw new Error('Native OpenCode resume database is unavailable; keep the original conversation and restore its database')
    return target
  }
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    copyReadOnlySqlite(source, temporary)
    chmodSync(temporary, 0o600)
    const db = new Database(temporary)
    try {
      const columns = new Set((db.prepare('PRAGMA table_info(session_v2)').all() as Array<{ name: string }>).map(row => row.name))
      if (!['id', 'parent_id', 'time_suspended', 'resume_attempts', 'time_idle', 'idle_outcome'].every(name => columns.has(name)))
        throw new Error('Unsupported native OpenCode database layout; isolation requires the V2 session schema')
      db.pragma('foreign_keys = ON'); db.pragma('secure_delete = ON')
      db.transaction(() => {
        db.prepare(`WITH RECURSIVE owned(id) AS (SELECT id FROM session_v2 WHERE id = ?
          UNION SELECT child.id FROM session_v2 child JOIN owned parent ON child.parent_id = parent.id)
          DELETE FROM session_v2 WHERE id NOT IN (SELECT id FROM owned)`).run(nativeId ?? '')
        // An imported old execution is an interrupted fact, never an instruction
        // for a new process to continue generating or repeating its effects.
        db.prepare(`UPDATE session_v2 SET time_suspended = NULL, resume_attempts = 0,
          time_idle = CASE WHEN time_suspended IS NOT NULL THEN ? ELSE time_idle END,
          idle_outcome = CASE WHEN time_suspended IS NOT NULL THEN 'interrupted' ELSE idle_outcome END`).run(Date.now())
        db.prepare('UPDATE session_v2 SET parent_id = NULL WHERE id = ?').run(nativeId ?? '')
        const legacy = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='session'").get()
        if (legacy) db.exec('DELETE FROM session')
      })()
      db.exec('VACUUM')
    } finally { db.close() }
    renameSync(temporary, target)
    return target
  } finally { rmSync(temporary, { force: true }); rmSync(`${temporary}-wal`, { force: true }); rmSync(`${temporary}-shm`, { force: true }) }
}
