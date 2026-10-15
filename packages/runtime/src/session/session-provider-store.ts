/**
 * SQLite-backed session_providers table (node / CLI).
 * Aligns with desktop `session-provider-repo` schema for multi-profile models
 * and collaboration.listProfiles.
 */

import { randomUUID } from 'node:crypto'
import type { HarnessId } from '@superone/shared/session-types'
import { BASE_SESSION_PROVIDER_DEFINITIONS } from '@superone/shared/session-provider-definitions'
import { parseAgentProfileSpec, providerLaunchRuntime } from '@superone/shared/agent-profile'
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

const VALID_HARNESS_IDS = new Set<string>(
  BASE_SESSION_PROVIDER_DEFINITIONS.map((provider) => provider.harnessId),
)

function assertHarnessId(raw: string): HarnessId {
  if (!VALID_HARNESS_IDS.has(raw)) {
    throw Object.assign(new Error(`Unknown harness: ${raw}`), { code: 'invalid_argument' })
  }
  return raw as HarnessId
}

function normalizeConfig(harnessId: HarnessId, config: unknown): unknown {
  if (config === undefined || config === null) return {}
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw Object.assign(new Error('config must be an object'), { code: 'invalid_argument' })
  }
  const profile = (config as { profile?: unknown }).profile
  if (profile === undefined) return config
  // Harness-agnostic, so checked here for every host rather than in each harness schema.
  const parsed = parseAgentProfileSpec(profile, harnessId)
  if (!parsed.ok) throw Object.assign(new Error(parsed.error), { code: 'invalid_argument' })
  return { ...config, profile: parsed.value }
}

function hasProfile(config: unknown): boolean {
  return !!config && typeof config === 'object' && (config as { profile?: unknown }).profile !== undefined
}

function profileWriteRefused(): Error {
  return Object.assign(
    new Error('Agent profiles change only through agent_profile_apply / agent_profile_delete, which ask the user first.'),
    { code: 'failed_precondition' },
  )
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
  for (const seed of BASE_SESSION_PROVIDER_DEFINITIONS) {
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

/**
 * Provider rows as RPC and IPC clients see them. These writes refuse agent
 * profile rows (`config.profile`): a profile is a standing permission boundary
 * the user confirms change by change, see {@link AgentProfileWriter}.
 */
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
 * Agent profile writes, for a host's own confirm flow only — never served
 * over RPC or IPC. `expected` is the row the user saw: a row changed since
 * fails with `aborted` instead of being overwritten with an unseen state.
 */
export interface AgentProfileWriter {
  create(input: CreateSessionProviderInput & { config: { profile: unknown } }): SessionProviderRecord
  update(id: string, patch: UpdateSessionProviderInput & { config: { profile: unknown } }, expected: SessionProviderRecord): SessionProviderRecord
  delete(id: string, expected: SessionProviderRecord): boolean
}

/**
 * Extract session.create seed fields from a session_providers.config_json object:
 * the row's launch runtime (`providerLaunchRuntime`) plus its permission fields.
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
  const runtime = providerLaunchRuntime(config)
  const model = runtime?.model
  const effort = runtime?.effort
  return {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(str('permissionMode') ? { permissionMode: str('permissionMode') } : {}),
    ...(str('sandboxMode') ? { sandboxMode: str('sandboxMode') } : {}),
  }
}

export interface SessionProviderStoreOptions {
  /** The host's own check of a profile config (its harness schemas); returns the config to store. */
  validateConfig?(harnessId: HarnessId, config: unknown): unknown
}

export function createSessionProviderStore(
  db: SqliteDatabase,
  options: SessionProviderStoreOptions = {},
): SessionProviderStore & { profiles: AgentProfileWriter } {
  ensureSessionProvidersTable(db)
  const validConfig = (harnessId: HarnessId, config: unknown): unknown => {
    const normalized = normalizeConfig(harnessId, config)
    if (!options.validateConfig) return normalized
    try {
      return options.validateConfig(harnessId, normalized)
    } catch (err) {
      // The host's check rejected the client's config, whatever its schema library throws.
      throw Object.assign(new Error(err instanceof Error ? err.message : String(err), { cause: err }), {
        code: 'invalid_argument',
      })
    }
  }

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

  const insert = (input: CreateSessionProviderInput): SessionProviderRecord => {
    const harnessId = assertHarnessId(String(input.harnessId ?? ''))
    const name = String(input.name ?? '').trim()
    if (!name) {
      throw Object.assign(new Error('name required'), { code: 'invalid_argument' })
    }
    const config = validConfig(harnessId, input.config)
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

  const existingCustom = (id: string, action: 'update' | 'delete'): SessionProviderRecord | null => {
    const existing = get(id)
    if (!existing) {
      if (action === 'delete') return null
      throw Object.assign(new Error(`Provider not found: ${id}`), { code: 'not_found' })
    }
    if (existing.isBase) {
      throw Object.assign(new Error(`Cannot ${action} base provider: ${id}`), {
        code: 'failed_precondition',
      })
    }
    return existing
  }

  const write = (existing: SessionProviderRecord, patch: UpdateSessionProviderInput): SessionProviderRecord => {
    const name =
      patch.name !== undefined ? String(patch.name).trim() || existing.name : existing.name
    const config = patch.config !== undefined ? validConfig(existing.harnessId, patch.config) : existing.config
    const now = new Date().toISOString()
    db.prepare(
      'UPDATE session_providers SET name = ?, config_json = ?, updated_at = ? WHERE id = ?',
    ).run(name, JSON.stringify(config), now, existing.id)
    return get(existing.id)!
  }

  const remove = (id: string): void => {
    db.prepare('DELETE FROM session_providers WHERE id = ?').run(id)
  }

  /** The row still holds what the user confirmed against. */
  const assertUnchanged = (current: SessionProviderRecord, expected: SessionProviderRecord): void => {
    if (current.name === expected.name && JSON.stringify(current.config) === JSON.stringify(expected.config)) return
    throw Object.assign(new Error(`Agent profile ${current.id} changed while waiting for confirmation.`), { code: 'aborted' })
  }

  const create = (input: CreateSessionProviderInput): SessionProviderRecord => {
    if (hasProfile(input.config)) throw profileWriteRefused()
    return insert(input)
  }

  const update = (id: string, patch: UpdateSessionProviderInput): SessionProviderRecord => {
    const existing = existingCustom(id, 'update')!
    if (hasProfile(existing.config) || hasProfile(patch.config)) throw profileWriteRefused()
    return write(existing, patch)
  }

  const del = (id: string): boolean => {
    const existing = existingCustom(id, 'delete')
    if (!existing) return false
    if (hasProfile(existing.config)) throw profileWriteRefused()
    remove(id)
    return true
  }

  const profiles: AgentProfileWriter = {
    create: insert,
    update: (id, patch, expected) => {
      const existing = existingCustom(id, 'update')!
      assertUnchanged(existing, expected)
      return write(existing, patch)
    },
    delete: (id, expected) => {
      const existing = existingCustom(id, 'delete')
      if (!existing) return false
      assertUnchanged(existing, expected)
      remove(id)
      return true
    },
  }

  return {
    list,
    listByHarness,
    get,
    getBase,
    create,
    update,
    delete: del,
    profiles,
  }
}
