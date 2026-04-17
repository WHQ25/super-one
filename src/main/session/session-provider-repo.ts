import { randomUUID } from 'crypto'
import { z } from 'zod'
import { getDb } from '../database'
import { harnessRegistry } from './harness-registry'
import type { HarnessId, SessionProvider } from './types'

interface SessionProviderRow {
  id: string
  harness_id: HarnessId
  name: string
  is_official: number
  config_json: string
  created_at: string
  updated_at: string
}

function rowToProvider(row: SessionProviderRow): SessionProvider {
  return {
    id: row.id,
    harnessId: row.harness_id,
    name: row.name,
    isOfficial: row.is_official === 1,
    config: JSON.parse(row.config_json),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

function validateConfig(harnessId: HarnessId, config: unknown): unknown {
  const harness = harnessRegistry.get(harnessId)
  if (!harness) throw new Error(`Unknown harness: ${harnessId}`)
  const schema = harness.configSchema as z.ZodSchema
  return schema.parse(config)
}

export function listSessionProviders(): SessionProvider[] {
  const rows = getDb()
    .prepare('SELECT * FROM session_providers ORDER BY is_official DESC, created_at')
    .all() as SessionProviderRow[]
  return rows.map(rowToProvider)
}

export function listByHarness(harnessId: HarnessId): SessionProvider[] {
  const rows = getDb()
    .prepare('SELECT * FROM session_providers WHERE harness_id = ? ORDER BY is_official DESC, created_at')
    .all(harnessId) as SessionProviderRow[]
  return rows.map(rowToProvider)
}

export function getSessionProvider(id: string): SessionProvider | null {
  const row = getDb()
    .prepare('SELECT * FROM session_providers WHERE id = ?')
    .get(id) as SessionProviderRow | undefined
  return row ? rowToProvider(row) : null
}

export function getOfficialProvider(harnessId: HarnessId): SessionProvider {
  const p = getSessionProvider(`${harnessId}-official`)
  if (!p) throw new Error(`Official provider missing: ${harnessId}-official`)
  return p
}

export interface CreateSessionProviderInput {
  harnessId: HarnessId
  name: string
  config: unknown
  id?: string
}

export function createSessionProvider(input: CreateSessionProviderInput): SessionProvider {
  const validated = validateConfig(input.harnessId, input.config)
  const id = input.id ?? `${input.harnessId}-${randomUUID()}`
  const now = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO session_providers (id, harness_id, name, is_official, config_json, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?, ?)
  `).run(id, input.harnessId, input.name, JSON.stringify(validated), now, now)
  const created = getSessionProvider(id)
  if (!created) throw new Error(`Failed to create provider: ${id}`)
  return created
}

export interface UpdateSessionProviderInput {
  name?: string
  config?: unknown
}

export function updateSessionProvider(id: string, patch: UpdateSessionProviderInput): SessionProvider {
  const existing = getSessionProvider(id)
  if (!existing) throw new Error(`Provider not found: ${id}`)
  if (existing.isOfficial) throw new Error(`Cannot update official provider: ${id}`)
  const name = patch.name ?? existing.name
  const config = patch.config !== undefined
    ? validateConfig(existing.harnessId, patch.config)
    : existing.config
  const now = new Date().toISOString()
  getDb()
    .prepare('UPDATE session_providers SET name = ?, config_json = ?, updated_at = ? WHERE id = ?')
    .run(name, JSON.stringify(config), now, id)
  return getSessionProvider(id)!
}

export function deleteSessionProvider(id: string): boolean {
  const existing = getSessionProvider(id)
  if (!existing) return false
  if (existing.isOfficial) throw new Error(`Cannot delete official provider: ${id}`)
  getDb().prepare('DELETE FROM session_providers WHERE id = ?').run(id)
  return true
}
