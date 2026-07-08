import { app, type App } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import type { ApiProvider, CreateProviderRequest, HarnessId, HarnessResourcesMap, UpdateProviderRequest } from '@superone/shared/agent-types'
import { runDatabaseMigrations } from './database-migrations'
import { decryptSecret, encryptSecret } from './crypto/secret-store'

export { runDatabaseMigrations }

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'superone.db')
  db = new Database(dbPath)

  // Performance pragmas
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runDatabaseMigrations(db)

  return db
}


export function getCachedHarnessResources<H extends HarnessId>(
  harnessId: H,
): HarnessResourcesMap[H] | null {
  const row = getDb()
    .prepare('SELECT resources_json FROM harness_resource_cache WHERE harness_id = ?')
    .get(harnessId) as { resources_json: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.resources_json) as HarnessResourcesMap[H]
  } catch {
    return null
  }
}

export function setCachedHarnessResources<H extends HarnessId>(
  harnessId: H,
  resources: HarnessResourcesMap[H],
): void {
  getDb().prepare(`
    INSERT INTO harness_resource_cache (harness_id, resources_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(harness_id) DO UPDATE SET
      resources_json = excluded.resources_json,
      updated_at = excluded.updated_at
  `).run(harnessId, JSON.stringify(resources), new Date().toISOString())
}

export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 6) return '***'
  return '***' + key.slice(-6)
}

function maskProvider(row: ApiProvider): ApiProvider {
  return { ...row, api_key: maskApiKey(decryptSecret(row.api_key)) }
}

/** Main-only: decrypt the api_key so it can be injected into a backend env. Never send to the renderer. */
function decryptProvider(row: ApiProvider | undefined): ApiProvider | undefined {
  return row ? { ...row, api_key: decryptSecret(row.api_key) } : undefined
}

export function getAllProviders(): ApiProvider[] {
  return (getDb().prepare('SELECT * FROM api_providers ORDER BY sort_order, created_at').all() as ApiProvider[]).map(maskProvider)
}

export function getActiveProvider(agentType: string = 'claude'): ApiProvider | undefined {
  const col = agentType === 'codex' ? 'is_active_codex' : 'is_active_claude'
  return decryptProvider(getDb().prepare(`SELECT * FROM api_providers WHERE ${col} = 1`).get() as ApiProvider | undefined)
}

export function getActiveProviderRaw(agentType: string = 'claude'): ApiProvider | undefined {
  const col = agentType === 'codex' ? 'is_active_codex' : 'is_active_claude'
  return decryptProvider(getDb().prepare(`SELECT * FROM api_providers WHERE ${col} = 1`).get() as ApiProvider | undefined)
}

export function getProviderByIdRaw(id: string): ApiProvider | undefined {
  return decryptProvider(getDb().prepare('SELECT * FROM api_providers WHERE id = ?').get(id) as ApiProvider | undefined)
}

export function createProvider(data: CreateProviderRequest): ApiProvider {
  const now = new Date().toISOString()
  const id = randomUUID()
  const maxOrder = (getDb().prepare('SELECT MAX(sort_order) as m FROM api_providers').get() as { m: number | null })?.m ?? -1
  getDb().prepare(`
    INSERT INTO api_providers (id, name, key_name, provider_type, api_key, api_key_env, category, supported_agents, agent_configs, capabilities, notes, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.key_name ?? '',
    data.provider_type ?? 'custom',
    encryptSecret(data.api_key ?? ''),
    data.api_key_env ?? '',
    data.category ?? 'custom',
    data.supported_agents ?? '["claude"]',
    data.agent_configs ?? '{}',
    data.capabilities ?? '[]',
    data.notes ?? '',
    maxOrder + 1,
    now,
    now,
  )
  return maskProvider(getDb().prepare('SELECT * FROM api_providers WHERE id = ?').get(id) as ApiProvider)
}

export function updateProvider(id: string, data: UpdateProviderRequest): ApiProvider | undefined {
  const existing = getDb().prepare('SELECT * FROM api_providers WHERE id = ?').get(id) as ApiProvider | undefined
  if (!existing) return undefined
  const skipApiKey = data.api_key !== undefined && data.api_key.startsWith('***')
  getDb().prepare(`
    UPDATE api_providers SET
      name = ?, key_name = ?, provider_type = ?, ${skipApiKey ? '' : 'api_key = ?,'}
      api_key_env = ?, category = ?, supported_agents = ?, agent_configs = ?, capabilities = ?,
      notes = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    ...[
      data.name ?? existing.name,
      data.key_name ?? existing.key_name,
      data.provider_type ?? existing.provider_type,
      ...(skipApiKey ? [] : [encryptSecret(data.api_key ?? existing.api_key)]),
      data.api_key_env ?? existing.api_key_env,
      data.category ?? existing.category,
      data.supported_agents ?? existing.supported_agents,
      data.agent_configs ?? existing.agent_configs,
      data.capabilities ?? existing.capabilities,
      data.notes ?? existing.notes,
      data.sort_order ?? existing.sort_order,
      new Date().toISOString(),
      id,
    ],
  )
  return maskProvider(getDb().prepare('SELECT * FROM api_providers WHERE id = ?').get(id) as ApiProvider)
}

export function deleteProvider(id: string): boolean {
  return getDb().prepare('DELETE FROM api_providers WHERE id = ?').run(id).changes > 0
}

export function activateProvider(id: string, agentType: string): boolean {
  const d = getDb()
  const col = agentType === 'codex' ? 'is_active_codex' : 'is_active_claude'
  d.prepare(`UPDATE api_providers SET ${col} = 0`).run()
  return d.prepare(`UPDATE api_providers SET ${col} = 1 WHERE id = ?`).run(id).changes > 0
}

export function deactivateAllProviders(agentType: string): void {
  const col = agentType === 'codex' ? 'is_active_codex' : 'is_active_claude'
  getDb().prepare(`UPDATE api_providers SET ${col} = 0`).run()
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export interface PairedDeviceRow {
  id: string
  name: string
  paired_at: string
  last_seen_at: string | null
}

export function upsertPairedDevice(id: string, name: string): void {
  getDb().prepare(`
    INSERT INTO paired_devices (id, name, paired_at, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at
  `).run(id, name, new Date().toISOString(), new Date().toISOString())
}

export function listPairedDevices(): PairedDeviceRow[] {
  return getDb().prepare('SELECT * FROM paired_devices ORDER BY paired_at DESC').all() as PairedDeviceRow[]
}

export function deletePairedDevice(id: string): void {
  getDb().prepare('DELETE FROM paired_devices WHERE id = ?').run(id)
}

export function isPairedDevice(id: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM paired_devices WHERE id = ?').get(id)
}
