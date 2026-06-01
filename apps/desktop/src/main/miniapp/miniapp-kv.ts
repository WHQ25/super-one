import type { Database as DatabaseType } from 'better-sqlite3'
import type { MiniAppDbScope } from '@superone/shared/miniapp-types'
import { getDbForApp } from './miniapp-db'

let ensuredDbs = new WeakSet<DatabaseType>()

function ensureTable(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __miniapp_kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
}

async function ensureForApp(scope: MiniAppDbScope, projectDir: string | null | undefined, appId: string): Promise<DatabaseType> {
  const db = await getDbForApp(scope, projectDir, appId)
  if (!ensuredDbs.has(db)) {
    ensureTable(db)
    ensuredDbs.add(db)
  }
  return db
}

export async function kvGet(scope: MiniAppDbScope, projectDir: string | null | undefined, appId: string, key: string): Promise<unknown | undefined> {
  const db = await ensureForApp(scope, projectDir, appId)
  const row = db.prepare('SELECT v FROM __miniapp_kv WHERE k = ?').get(key) as { v: string } | undefined
  if (!row) return undefined
  try {
    return JSON.parse(row.v)
  } catch {
    return undefined
  }
}

export async function kvSet(scope: MiniAppDbScope, projectDir: string | null | undefined, appId: string, key: string, value: unknown): Promise<void> {
  const db = await ensureForApp(scope, projectDir, appId)
  const serialized = JSON.stringify(value)
  db.prepare(`
    INSERT INTO __miniapp_kv (k, v, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at
  `).run(key, serialized, Date.now())
}

export async function kvDelete(scope: MiniAppDbScope, projectDir: string | null | undefined, appId: string, key: string): Promise<void> {
  const db = await ensureForApp(scope, projectDir, appId)
  db.prepare('DELETE FROM __miniapp_kv WHERE k = ?').run(key)
}

export async function kvList(scope: MiniAppDbScope, projectDir: string | null | undefined, appId: string, prefix?: string): Promise<string[]> {
  const db = await ensureForApp(scope, projectDir, appId)
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

export async function handleKvRequest(
  projectDir: string | null | undefined,
  scope: MiniAppDbScope,
  appId: string,
  op: KvOp,
  args: KvRequestArgs,
): Promise<unknown> {
  switch (op) {
    case 'get': {
      if (typeof args.key !== 'string') throw new Error('kv.get: key required')
      return kvGet(scope, projectDir, appId, args.key)
    }
    case 'set': {
      if (typeof args.key !== 'string') throw new Error('kv.set: key required')
      await kvSet(scope, projectDir, appId, args.key, args.value)
      return undefined
    }
    case 'delete': {
      if (typeof args.key !== 'string') throw new Error('kv.delete: key required')
      await kvDelete(scope, projectDir, appId, args.key)
      return undefined
    }
    case 'list':
      return kvList(scope, projectDir, appId, typeof args.prefix === 'string' ? args.prefix : undefined)
    default:
      throw new Error(`Unknown kv op: ${op}`)
  }
}

export function _resetEnsuredForTests(): void {
  ensuredDbs = new WeakSet<DatabaseType>()
}
