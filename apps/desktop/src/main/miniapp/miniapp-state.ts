import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import { resolveMainWorktreeDir } from '../git/worktree-ops'
import { getUserAppDir } from './miniapp-service'

export type MiniAppStateScope = 'workspace' | 'global'
export type MiniAppStateOp = 'get' | 'update' | 'keys'

export interface MiniAppStoragePaths {
  workspaceStoragePath: string
  globalStoragePath: string
}

const connections = new Map<string, { appId: string; db: DatabaseType }>()
const projectRootCache = new Map<string, string>()

async function resolveProjectRoot(projectDir: string): Promise<string> {
  const cached = projectRootCache.get(projectDir)
  if (cached) return cached
  let root: string
  try {
    root = await resolveMainWorktreeDir(projectDir)
  } catch {
    root = projectDir
  }
  projectRootCache.set(projectDir, root)
  return root
}

function storagePathsForRoot(projectRoot: string, appId: string): MiniAppStoragePaths {
  return {
    workspaceStoragePath: join(projectRoot, '.superone', 'apps', appId, 'data'),
    globalStoragePath: join(getUserAppDir(appId), 'data'),
  }
}

export async function resolveMiniAppStoragePaths(
  projectDir: string,
  appId: string,
): Promise<MiniAppStoragePaths> {
  return storagePathsForRoot(await resolveProjectRoot(projectDir), appId)
}

/**
 * Sync variant for callers that cannot await. Returns null until the project
 * root has been resolved once (i.e. before the app's MiniApp Host started).
 */
export function peekMiniAppStoragePaths(
  projectDir: string,
  appId: string,
): MiniAppStoragePaths | null {
  const projectRoot = projectRootCache.get(projectDir)
  return projectRoot ? storagePathsForRoot(projectRoot, appId) : null
}

function stateDbPath(paths: MiniAppStoragePaths, scope: MiniAppStateScope): string {
  const storagePath = scope === 'workspace' ? paths.workspaceStoragePath : paths.globalStoragePath
  return join(storagePath, '.state.db')
}

/** Storage dirs are created on first write, never eagerly — an app that never
 * stores anything must not leave `.superone/apps/<id>/data` in the user's repo. */
function getStateDb(appId: string, paths: MiniAppStoragePaths, scope: MiniAppStateScope): DatabaseType {
  const dbPath = stateDbPath(paths, scope)
  const cached = connections.get(dbPath)
  if (cached?.db.open) return cached.db

  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  connections.set(dbPath, { appId, db })
  return db
}

export function handleMiniAppStateRequest(
  appId: string,
  paths: MiniAppStoragePaths,
  scope: MiniAppStateScope,
  op: MiniAppStateOp,
  key?: string,
  value?: unknown,
): unknown {
  if (scope !== 'workspace' && scope !== 'global') throw new Error(`Unknown state scope: ${String(scope)}`)
  const db = getStateDb(appId, paths, scope)
  if (op === 'keys') {
    return (db.prepare('SELECT key FROM state ORDER BY key').all() as Array<{ key: string }>).map((row) => row.key)
  }
  if (typeof key !== 'string' || key.length === 0) throw new Error(`state.${op}: key required`)
  if (op === 'get') {
    const row = db.prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined
    return row ? JSON.parse(row.value) : undefined
  }
  if (op === 'update') {
    if (value === undefined) {
      db.prepare('DELETE FROM state WHERE key = ?').run(key)
      return undefined
    }
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error('state.update: value must be JSON-serializable')
    db.prepare(`
      INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, serialized, Date.now())
    return undefined
  }
  throw new Error(`Unknown state operation: ${op}`)
}

export function closeMiniAppState(appId: string): void {
  for (const [path, connection] of connections) {
    if (connection.appId !== appId) continue
    try { connection.db.close() } catch { /* best-effort cleanup */ }
    connections.delete(path)
  }
}

export function closeMiniAppStatePaths(paths: MiniAppStoragePaths): void {
  for (const scope of ['workspace', 'global'] as const) {
    const path = stateDbPath(paths, scope)
    const connection = connections.get(path)
    if (!connection) continue
    try { connection.db.close() } catch { /* best-effort cleanup */ }
    connections.delete(path)
  }
}

export function closeAllMiniAppState(): void {
  for (const connection of connections.values()) {
    try { connection.db.close() } catch { /* best-effort cleanup */ }
  }
  connections.clear()
  projectRootCache.clear()
}
