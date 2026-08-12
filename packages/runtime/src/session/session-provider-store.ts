/**
 * SQLite-backed session_providers table (node / CLI).
 * Aligns with desktop `session-provider-repo` schema for multi-profile models
 * and collaboration.listProfiles.
 */

import { randomUUID } from 'node:crypto'
import type { HarnessId } from '@superone/shared/session-types'
import type { SqliteDatabase } from '../sqlite'

export interface SessionProviderRecord {
  id: string
  harnessId: HarnessId
  name: string
  isBase: boolean
  config: unknown
  createdAt: number
  updatedAt: number
}

interface SessionProviderRow {
  id: string
  harness_id: string
  name: string
  is_base: number
  config_json: string
  created_at: string
  updated_at: string
}

const VALID_HARNESS_IDS = new Set<string>(['claude', 'codex', 'acp', 'opencode', 'cursor'])

const BASE_SEEDS: Array<{ id: string; harnessId: HarnessId; name: string; config: unknown }> = [
  { id: 'claude-base', harnessId: 'claude', name: 'Claude (Base)', config: {} },
  { id: 'codex-base', harnessId: 'codex', name: 'Codex (Base)', config: {} },
  { id: 'acp-base', harnessId: 'acp', name: 'Others (ACP)', config: { agentId: 'grok-build' } },
  { id: 'opencode-base', harnessId: 'opencode', name: 'OpenCode (Base)', config: {} },
  { id: 'cursor-base', harnessId: 'cursor', name: 'Cursor (Base)', config: {} },
]

function assertHarnessId(raw: string): HarnessId {
  if (!VALID_HARNESS_IDS.has(raw)) {
    throw Object.assign(new Error(`Unknown harness: ${raw}`), { code: 'invalid_argument' })
  }
  return raw as HarnessId
}

function normalizeConfig(config: unknown): unknown {
  if (config === undefined || config === null) return {}
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw Object.assign(new Error('config must be an object'), { code: 'invalid_argument' })
  }
  return config
}

function rowToProvider(row: SessionProviderRow): SessionProviderRecord {
  let config: unknown = {}
  try {
    config = JSON.parse(row.config_json)
  } catch {
    config = {}
  }
  return {
    id: row.id,
    harnessId: row.harness_id as HarnessId,
    name: row.name,
    isBase: row.is_base === 1,
    config,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

export function ensureSessionProvidersTable(
  db: SqliteDatabase & { exec?: (sql: string) => void },
): void {
  const exec =
    typeof db.exec === 'function'
      ? db.exec.bind(db)
      : (sql: string) => {
          for (const stmt of sql
            .split(';')
            .map((s) => s.trim())
            .filter(Boolean)) {
            db.prepare(stmt).run()
          }
        }
  exec(`
CREATE TABLE IF NOT EXISTS session_providers (
  id TEXT PRIMARY KEY NOT NULL,
  harness_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_base INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_providers_harness ON session_providers(harness_id);
`)
  seedBaseSessionProviders(db)
}

function seedBaseSessionProviders(db: SqliteDatabase): void {
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO session_providers
      (id, harness_id, name, is_base, config_json, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)
  `)
  for (const seed of BASE_SEEDS) {
    stmt.run(seed.id, seed.harnessId, seed.name, JSON.stringify(seed.config), now, now)
  }
}

export interface CreateSessionProviderInput {
  harnessId: string
  name: string
  config?: unknown
  id?: string
}

export interface UpdateSessionProviderInput {
  name?: string
  config?: unknown
}

export interface SessionProviderStore {
  list(): SessionProviderRecord[]
  listByHarness(harnessId: string): SessionProviderRecord[]
  get(id: string): SessionProviderRecord | null
  getBase(harnessId: string): SessionProviderRecord
  create(input: CreateSessionProviderInput): SessionProviderRecord
  update(id: string, patch: UpdateSessionProviderInput): SessionProviderRecord
  delete(id: string): boolean
}

/**
 * Extract session.create seed fields from a session_providers.config_json object.
 * Supports both claude-style `effort` and codex-style `reasoningEffort`.
 */
export function settingsFromSessionProviderConfig(config: unknown): {
  model?: string
  effort?: string
  permissionMode?: string
  sandboxMode?: string
} {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {}
  const c = config as Record<string, unknown>
  const str = (key: string): string | undefined => {
    const v = c[key]
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
  }
  return {
    ...(str('model') ? { model: str('model') } : {}),
    ...(str('effort') || str('reasoningEffort')
      ? { effort: str('effort') ?? str('reasoningEffort') }
      : {}),
    ...(str('permissionMode') ? { permissionMode: str('permissionMode') } : {}),
    ...(str('sandboxMode') ? { sandboxMode: str('sandboxMode') } : {}),
  }
}

export function createSessionProviderStore(db: SqliteDatabase): SessionProviderStore {
  ensureSessionProvidersTable(db)

  const list = (): SessionProviderRecord[] => {
    const rows = db
      .prepare('SELECT * FROM session_providers ORDER BY is_base DESC, created_at')
      .all() as SessionProviderRow[]
    return rows.map(rowToProvider)
  }

  const listByHarness = (harnessId: string): SessionProviderRecord[] => {
    const id = assertHarnessId(harnessId)
    const rows = db
      .prepare(
        'SELECT * FROM session_providers WHERE harness_id = ? ORDER BY is_base DESC, created_at',
      )
      .all(id) as SessionProviderRow[]
    return rows.map(rowToProvider)
  }

  const get = (id: string): SessionProviderRecord | null => {
    const row = db
      .prepare('SELECT * FROM session_providers WHERE id = ?')
      .get(id) as SessionProviderRow | undefined
    return row ? rowToProvider(row) : null
  }

  const getBase = (harnessId: string): SessionProviderRecord => {
    const id = assertHarnessId(harnessId)
    const p = get(`${id}-base`)
    if (!p) {
      throw Object.assign(new Error(`Base provider missing: ${id}-base`), { code: 'not_found' })
    }
    return p
  }

  const create = (input: CreateSessionProviderInput): SessionProviderRecord => {
    const harnessId = assertHarnessId(String(input.harnessId ?? ''))
    const name = String(input.name ?? '').trim()
    if (!name) {
      throw Object.assign(new Error('name required'), { code: 'invalid_argument' })
    }
    const config = normalizeConfig(input.config)
    const id = input.id?.trim() || `${harnessId}-${randomUUID()}`
    if (get(id)) {
      throw Object.assign(new Error(`Provider already exists: ${id}`), { code: 'conflict' })
    }
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO session_providers (id, harness_id, name, is_base, config_json, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, ?)
    `).run(id, harnessId, name, JSON.stringify(config), now, now)
    const created = get(id)
    if (!created) throw Object.assign(new Error(`Failed to create provider: ${id}`), { code: 'internal' })
    return created
  }

  const update = (id: string, patch: UpdateSessionProviderInput): SessionProviderRecord => {
    const existing = get(id)
    if (!existing) {
      throw Object.assign(new Error(`Provider not found: ${id}`), { code: 'not_found' })
    }
    if (existing.isBase) {
      throw Object.assign(new Error(`Cannot update base provider: ${id}`), {
        code: 'failed_precondition',
      })
    }
    const name =
      patch.name !== undefined ? String(patch.name).trim() || existing.name : existing.name
    const config = patch.config !== undefined ? normalizeConfig(patch.config) : existing.config
    const now = new Date().toISOString()
    db.prepare(
      'UPDATE session_providers SET name = ?, config_json = ?, updated_at = ? WHERE id = ?',
    ).run(name, JSON.stringify(config), now, id)
    return get(id)!
  }

  const del = (id: string): boolean => {
    const existing = get(id)
    if (!existing) return false
    if (existing.isBase) {
      throw Object.assign(new Error(`Cannot delete base provider: ${id}`), {
        code: 'failed_precondition',
      })
    }
    db.prepare('DELETE FROM session_providers WHERE id = ?').run(id)
    return true
  }

  return {
    list,
    listByHarness,
    get,
    getBase,
    create,
    update,
    delete: del,
  }
}
