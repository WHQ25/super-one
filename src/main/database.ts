import { app, type App } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { is } from '@electron-toolkit/utils'
import type { ApiProvider, CreateProviderRequest, UpdateProviderRequest } from '../shared/agent-types'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'superone.db')
  db = new Database(dbPath)

  // Performance pragmas
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  migrate(db)

  return db
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      claude_session_id TEXT UNIQUE,
      title TEXT,
      created_at TEXT NOT NULL,
      total_cost_usd REAL DEFAULT 0,
      context_tokens INTEGER DEFAULT 0,
      provider TEXT DEFAULT 'claude'
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      claude_session_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      metadata_json TEXT,
      FOREIGN KEY (claude_session_id) REFERENCES sessions(claude_session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(claude_session_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_last_user ON chat_messages(claude_session_id, role, created_at);
  `)

  // Drop legacy init_cache table if it exists (data now fetched at app startup via connect-claude)
  db.exec('DROP TABLE IF EXISTS init_cache')

  // Add is_worktree and git_branch columns to sessions if missing
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'is_worktree')) {
    db.exec('ALTER TABLE sessions ADD COLUMN is_worktree INTEGER DEFAULT 0')
  }
  if (!cols.some((c) => c.name === 'git_branch')) {
    db.exec('ALTER TABLE sessions ADD COLUMN git_branch TEXT')
  }
  if (!cols.some((c) => c.name === 'worktree_path')) {
    db.exec('ALTER TABLE sessions ADD COLUMN worktree_path TEXT')
  }
  if (!cols.some((c) => c.name === 'is_pinned')) {
    db.exec('ALTER TABLE sessions ADD COLUMN is_pinned INTEGER DEFAULT 0')
  }
  if (!cols.some((c) => c.name === 'provider')) {
    db.exec("ALTER TABLE sessions ADD COLUMN provider TEXT DEFAULT 'claude'")
  }
  if (!cols.some((c) => c.name === 'is_hidden')) {
    db.exec('ALTER TABLE sessions ADD COLUMN is_hidden INTEGER DEFAULT 0')
  }

  // Add checkpoint_id column to chat_messages if missing
  const msgCols = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>
  if (!msgCols.some((c) => c.name === 'checkpoint_id')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN checkpoint_id TEXT')
  }
  if (!msgCols.some((c) => c.name === 'resume_point_id')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN resume_point_id TEXT')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL DEFAULT 'anthropic',
      base_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      extra_env TEXT NOT NULL DEFAULT '{}',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `)

  const provCols = db.prepare("PRAGMA table_info(api_providers)").all() as Array<{ name: string }>
  if (!provCols.some((c) => c.name === 'agent_type')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'claude'")
  }
  if (!provCols.some((c) => c.name === 'api_format')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN api_format TEXT NOT NULL DEFAULT 'anthropic'")
  }
  if (!provCols.some((c) => c.name === 'category')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN category TEXT NOT NULL DEFAULT 'custom'")
  }
  if (!provCols.some((c) => c.name === 'supported_agents')) {
    db.exec(`ALTER TABLE api_providers ADD COLUMN supported_agents TEXT NOT NULL DEFAULT '["claude"]'`)
  }
  if (!provCols.some((c) => c.name === 'agent_configs')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN agent_configs TEXT NOT NULL DEFAULT '{}'")
  }
  if (!provCols.some((c) => c.name === 'is_active_claude')) {
    db.exec('ALTER TABLE api_providers ADD COLUMN is_active_claude INTEGER NOT NULL DEFAULT 0')
  }
  if (!provCols.some((c) => c.name === 'is_active_codex')) {
    db.exec('ALTER TABLE api_providers ADD COLUMN is_active_codex INTEGER NOT NULL DEFAULT 0')
  }

  migrateProvidersToUnified(db)

  db.exec(`
    CREATE TABLE IF NOT EXISTS global_resource_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      models_json TEXT NOT NULL,
      account_json TEXT NOT NULL,
      slash_commands_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  if (is.dev) seedDevProviders(db)
}

function migrateProvidersToUnified(db: Database.Database): void {
  const rows = db.prepare('SELECT * FROM api_providers WHERE agent_configs = \'{}\'').all() as ApiProvider[]
  if (rows.length === 0) return
  const stmt = db.prepare(`
    UPDATE api_providers SET
      supported_agents = ?, agent_configs = ?,
      is_active_claude = ?, is_active_codex = ?
    WHERE id = ?
  `)
  for (const row of rows) {
    const agentType = row.agent_type || 'claude'
    const supportedAgents = JSON.stringify([agentType])
    const config = {
      base_url: row.base_url || '',
      model_env: '{}',
      extra_env: row.extra_env || '{}',
      api_format: row.api_format || 'anthropic',
    }
    const agentConfigs = JSON.stringify({ [agentType]: config })
    const isActiveClaude = agentType === 'claude' ? row.is_active : 0
    const isActiveCodex = agentType === 'codex' ? row.is_active : 0
    stmt.run(supportedAgents, agentConfigs, isActiveClaude, isActiveCodex, row.id)
  }
}

function seedDevProviders(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) as c FROM api_providers').get() as { c: number }).c
  if (count > 0) return
  const now = new Date().toISOString()
  const makeClaudeConfig = (url: string, env: string) => JSON.stringify({
    claude: { base_url: url, model_env: '{}', extra_env: env, api_format: 'anthropic' },
  })
  const seeds = [
    { name: 'GLM (CN)', type: 'custom', key: 'sk-test-zhipu-123456', category: 'model_provider', agents: '["claude"]', configs: makeClaudeConfig('https://open.bigmodel.cn/api/anthropic', '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_AUTH_TOKEN":"","ANTHROPIC_MODEL":"glm-4.7","ANTHROPIC_DEFAULT_SONNET_MODEL":"glm-4.7","ANTHROPIC_DEFAULT_OPUS_MODEL":"glm-5","ANTHROPIC_DEFAULT_HAIKU_MODEL":"glm-4.5-air"}'), activeClaude: 1 },
    { name: 'Kimi', type: 'custom', key: 'sk-test-kimi-abcdef', category: 'model_provider', agents: '["claude"]', configs: makeClaudeConfig('https://api.kimi.com/coding/', '{"ANTHROPIC_MODEL":"kimi-k2","ANTHROPIC_DEFAULT_SONNET_MODEL":"kimi-k2","ANTHROPIC_DEFAULT_OPUS_MODEL":"kimi-k2","ANTHROPIC_DEFAULT_HAIKU_MODEL":"kimi-k2"}'), activeClaude: 0 },
    { name: 'OpenRouter', type: 'openrouter', key: 'sk-or-test-999888', category: 'aggregator', agents: '["claude","codex"]', configs: JSON.stringify({ claude: { base_url: 'https://openrouter.ai/api', model_env: '{}', extra_env: '{"ANTHROPIC_API_KEY":""}', api_format: 'anthropic' }, codex: { base_url: 'https://openrouter.ai/api/v1', model_env: '{}', extra_env: '{"OPENAI_BASE_URL":"https://openrouter.ai/api/v1"}', api_format: 'openai_chat' } }), activeClaude: 0 },
    { name: 'AWS Bedrock', type: 'bedrock', key: '', category: 'cloud_platform', agents: '["claude"]', configs: makeClaudeConfig('', '{"CLAUDE_CODE_USE_BEDROCK":"1","AWS_REGION":"us-east-1","AWS_ACCESS_KEY_ID":"","AWS_SECRET_ACCESS_KEY":"","AWS_SESSION_TOKEN":""}'), activeClaude: 0 },
    { name: 'Google Vertex', type: 'vertex', key: '', category: 'cloud_platform', agents: '["claude"]', configs: makeClaudeConfig('', '{"CLAUDE_CODE_USE_VERTEX":"1","CLOUD_ML_REGION":"global","ANTHROPIC_VERTEX_PROJECT_ID":"my-gcp-project"}'), activeClaude: 0 },
  ]
  const stmt = db.prepare('INSERT INTO api_providers (id, name, provider_type, api_key, category, supported_agents, agent_configs, is_active_claude, is_active_codex, sort_order, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  seeds.forEach((s, i) => stmt.run(randomUUID(), s.name, s.type, s.key, s.category, s.agents, s.configs, s.activeClaude, 0, i, '', now, now))
}

export function getCachedResources(): { models: unknown[]; account: Record<string, unknown>; slashCommands: unknown[] } | null {
  const row = getDb().prepare('SELECT models_json, account_json, slash_commands_json FROM global_resource_cache WHERE id = 1').get() as
    | { models_json: string; account_json: string; slash_commands_json: string }
    | undefined
  if (!row) return null
  return {
    models: JSON.parse(row.models_json),
    account: JSON.parse(row.account_json),
    slashCommands: JSON.parse(row.slash_commands_json),
  }
}

export function setCachedResources(models: unknown[], account: unknown, slashCommands: unknown[]): void {
  getDb().prepare(`
    INSERT INTO global_resource_cache (id, models_json, account_json, slash_commands_json, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      models_json = excluded.models_json,
      account_json = excluded.account_json,
      slash_commands_json = excluded.slash_commands_json,
      updated_at = excluded.updated_at
  `).run(
    JSON.stringify(models),
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
