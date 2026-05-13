import type { Database as DatabaseType } from 'better-sqlite3'
import { getDbForApp } from './miniapp-db'

const ensuredApps = new Set<string>()

function ensureTable(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __miniapp_kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
}

function ensureForApp(appId: string): DatabaseType {
  const db = getDbForApp(appId)
  if (!ensuredApps.has(appId)) {
    ensureTable(db)
    ensuredApps.add(appId)
  }
  return db
}

export function kvGet(appId: string, key: string): unknown | undefined {
  const db = ensureForApp(appId)
  const row = db.prepare('SELECT v FROM __miniapp_kv WHERE k = ?').get(key) as { v: string } | undefined
  if (!row) return undefined
  try {
    return JSON.parse(row.v)
  } catch {
    return undefined
  }
}

export function kvSet(appId: string, key: string, value: unknown): void {
  const db = ensureForApp(appId)
  const serialized = JSON.stringify(value)
  db.prepare(`
    INSERT INTO __miniapp_kv (k, v, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at
  `).run(key, serialized, Date.now())
}

export function kvDelete(appId: string, key: string): void {
  const db = ensureForApp(appId)
  db.prepare('DELETE FROM __miniapp_kv WHERE k = ?').run(key)
}

export function kvList(appId: string, prefix?: string): string[] {
  const db = ensureForApp(appId)
  const rows = prefix
    ? db.prepare('SELECT k FROM __miniapp_kv WHERE k LIKE ? ORDER BY k').all(prefix + '%')
    : db.prepare('SELECT k FROM __miniapp_kv ORDER BY k').all()
  return (rows as Array<{ k: string }>).map((r) => r.k)
}

export type KvOp = 'get' | 'set' | 'delete' | 'list'

export interface KvRequestArgs {
  key?: string
  value?: unknown
  prefix?: string
}

export function handleKvRequest(appId: string, op: KvOp, args: KvRequestArgs): unknown {
  switch (op) {
    case 'get': {
      if (typeof args.key !== 'string') throw new Error('kv.get: key required')
      return kvGet(appId, args.key)
    }
    case 'set': {
      if (typeof args.key !== 'string') throw new Error('kv.set: key required')
      kvSet(appId, args.key, args.value)
      return undefined
    }
    case 'delete': {
      if (typeof args.key !== 'string') throw new Error('kv.delete: key required')
      kvDelete(appId, args.key)
      return undefined
    }
    case 'list':
      return kvList(appId, typeof args.prefix === 'string' ? args.prefix : undefined)
    default:
      throw new Error(`Unknown kv op: ${op}`)
  }
}

export function _resetEnsuredForTests(): void {
  ensuredApps.clear()
}
