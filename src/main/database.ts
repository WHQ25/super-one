import { app, type App } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import type { ApiProvider, CreateProviderRequest, UpdateProviderRequest } from '../shared/agent-types'
import { runDatabaseMigrations } from './database-migrations'

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


export function getCachedResources(): { models: unknown[]; codexModels: unknown[]; account: Record<string, unknown>; slashCommands: unknown[] } | null {
  const row = getDb().prepare('SELECT models_json, codex_models_json, account_json, slash_commands_json FROM global_resource_cache WHERE id = 1').get() as
    | { models_json: string; codex_models_json: string; account_json: string; slash_commands_json: string }
    | undefined
  if (!row) return null
  return {
    models: JSON.parse(row.models_json),
    codexModels: JSON.parse(row.codex_models_json || '[]'),
    account: JSON.parse(row.account_json),
    slashCommands: JSON.parse(row.slash_commands_json),
  }
}

export function setCachedResources(models: unknown[], codexModels: unknown[], account: unknown, slashCommands: unknown[]): void {
  getDb().prepare(`
    INSERT INTO global_resource_cache (id, models_json, codex_models_json, account_json, slash_commands_json, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      models_json = excluded.models_json,
      codex_models_json = excluded.codex_models_json,
      account_json = excluded.account_json,
      slash_commands_json = excluded.slash_commands_json,
      updated_at = excluded.updated_at
  `).run(
    JSON.stringify(models),
    JSON.stringify(codexModels),
    JSON.stringify(account),
    JSON.stringify(slashCommands),
    new Date().toISOString(),
  )
}

export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 6) return '***'
  return '***' + key.slice(-6)
}

function maskProvider(row: ApiProvider): ApiProvider {
  return { ...row, api_key: maskApiKey(row.api_key) }
}

export function getAllProviders(): ApiProvider[] {
  return (getDb().prepare('SELECT * FROM api_providers ORDER BY sort_order, created_at').all() as ApiProvider[]).map(maskProvider)
}

export function getActiveProvider(agentType: string = 'claude'): ApiProvider | undefined {
  const col = agentType === 'codex' ? 'is_active_codex' : 'is_active_claude'
  return getDb().prepare(`SELECT * FROM api_providers WHERE ${col} = 1`).get() as ApiProvider | undefined
}

export function getActiveProviderRaw(agentType: string = 'claude'): ApiProvider | undefined {
  const col = agentType === 'codex' ? 'is_active_codex' : 'is_active_claude'
  return getDb().prepare(`SELECT * FROM api_providers WHERE ${col} = 1`).get() as ApiProvider | undefined
}

export function createProvider(data: CreateProviderRequest): ApiProvider {
  const now = new Date().toISOString()
  const id = randomUUID()
  const maxOrder = (getDb().prepare('SELECT MAX(sort_order) as m FROM api_providers').get() as { m: number | null })?.m ?? -1
  getDb().prepare(`
    INSERT INTO api_providers (id, name, provider_type, api_key, category, supported_agents, agent_configs, notes, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.provider_type ?? 'custom',
    data.api_key ?? '',
    data.category ?? 'custom',
    data.supported_agents ?? '["claude"]',
    data.agent_configs ?? '{}',
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
      name = ?, provider_type = ?, ${skipApiKey ? '' : 'api_key = ?,'}
      category = ?, supported_agents = ?, agent_configs = ?,
      notes = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    ...[
      data.name ?? existing.name,
      data.provider_type ?? existing.provider_type,
      ...(skipApiKey ? [] : [data.api_key ?? existing.api_key]),
      data.category ?? existing.category,
      data.supported_agents ?? existing.supported_agents,
      data.agent_configs ?? existing.agent_configs,
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
