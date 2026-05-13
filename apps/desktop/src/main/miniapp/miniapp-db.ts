import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import Database from 'better-sqlite3'
import type { Database as DatabaseType, RunResult, Statement } from 'better-sqlite3'
import type { MiniAppDbOp, MiniAppDbStatement, MiniAppDbRunResult } from '@superone/shared/miniapp-types'
import { getAppInstallDir } from './miniapp-service'

const dbConnections = new Map<string, DatabaseType>()

const FORBIDDEN_SQL = /\b(ATTACH|DETACH|LOAD_EXTENSION)\b/i

const PRAGMA_NAME_RE = /^[a-z_][a-z0-9_]*(?:\(\s*[a-z_][a-z0-9_]*\s*\))?$/i

const PRAGMA_WHITELIST = new Set([
  'journal_mode',
  'synchronous',
  'user_version',
  'foreign_keys',
  'cache_size',
  'temp_store',
  'wal_checkpoint',
  'table_info',
  'table_list',
  'index_list',
  'index_info',
  'page_count',
  'page_size',
])

export function getDbForApp(appId: string): DatabaseType {
  const cached = dbConnections.get(appId)
  if (cached && cached.open) return cached

  const dbPath = join(getAppInstallDir(appId), 'data', 'main.db')

  try {
    mkdirSync(dirname(dbPath), { recursive: true })
  } catch (err) {
    throw new Error(`Failed to create db directory for app ${appId}: ${(err as Error).message}`)
  }

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('trusted_schema = OFF')
  db.pragma('foreign_keys = ON')

  dbConnections.set(appId, db)
  return db
}

export function closeDbForApp(appId: string): void {
  const db = dbConnections.get(appId)
  if (!db) return
  try { db.close() } catch { /* empty */ }
  dbConnections.delete(appId)
}

export function closeAllDbConnections(): void {
  for (const db of dbConnections.values()) {
    try { db.close() } catch { /* empty */ }
  }
  dbConnections.clear()
}

function sanitizeSql(sql: string): void {
  if (typeof sql !== 'string' || sql.length === 0) {
    throw new Error('SQL must be a non-empty string')
  }
  if (FORBIDDEN_SQL.test(sql)) {
    throw new Error('SQL contains forbidden keyword (ATTACH/DETACH/LOAD_EXTENSION are not allowed in mini-apps)')
  }
}

function normalizeParamValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  return value
}

function normalizeParams(params: unknown): unknown[] | Record<string, unknown> {
  if (params == null) return []
  if (Array.isArray(params)) return params.map(normalizeParamValue)
  if (typeof params === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      out[k] = normalizeParamValue(v)
    }
    return out
  }
  throw new Error('params must be an array or object')
}

function runOne(stmt: Statement, params: unknown[] | Record<string, unknown>): MiniAppDbRunResult {
  const result: RunResult = Array.isArray(params) ? stmt.run(...params) : stmt.run(params)
  return {
    changes: result.changes,
    lastInsertRowid: typeof result.lastInsertRowid === 'bigint' ? Number(result.lastInsertRowid) : result.lastInsertRowid,
  }
}

function buildPragmaExpression(name: string, value: unknown): string {
  const trimmed = name.trim()
  if (!PRAGMA_NAME_RE.test(trimmed)) {
    throw new Error('PRAGMA name has invalid format')
  }
  const baseName = trimmed.split('(')[0].toLowerCase()
  if (!PRAGMA_WHITELIST.has(baseName)) {
    throw new Error(`PRAGMA "${baseName}" is not allowed in mini-apps`)
  }
  if (value === undefined) return trimmed
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('PRAGMA value must be string or number')
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('PRAGMA value must be a finite number')
  }
  const literal = typeof value === 'string' ? `'${value.replace(/'/g, "''")}'` : String(value)
  return `${trimmed} = ${literal}`
}

export async function handleDbRequest(
  appId: string,
  op: MiniAppDbOp,
  args: Record<string, unknown>,
): Promise<unknown> {
  const db = getDbForApp(appId)

  switch (op) {
    case 'query': {
      const sql = args.sql as string
      sanitizeSql(sql)
      const params = normalizeParams(args.params)
      const stmt = db.prepare(sql)
      return Array.isArray(params) ? stmt.all(...params) : stmt.all(params)
    }
    case 'exec': {
      const sql = args.sql as string
      sanitizeSql(sql)
      const params = normalizeParams(args.params)
      const stmt = db.prepare(sql)
      return runOne(stmt, params)
    }
    case 'batch': {
      const stmts = args.statements as MiniAppDbStatement[] | undefined
      if (!Array.isArray(stmts) || stmts.length === 0) {
        throw new Error('batch requires a non-empty statements array')
      }
      for (const s of stmts) sanitizeSql(s.sql)
      const tx = db.transaction((list: MiniAppDbStatement[]) => {
        const out: MiniAppDbRunResult[] = []
        for (const s of list) {
          const params = normalizeParams(s.params)
          const stmt = db.prepare(s.sql)
          out.push(runOne(stmt, params))
        }
        return out
      })
      return tx(stmts)
    }
    case 'pragma': {
      const name = args.name as string
      if (typeof name !== 'string' || !name) throw new Error('pragma name required')
      const expr = buildPragmaExpression(name, args.value)
      return db.pragma(expr)
    }
    default:
      throw new Error(`Unknown db operation: ${op}`)
  }
}
