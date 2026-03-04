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

function seedDevProviders(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) as c FROM api_providers').get() as { c: number }).c
  if (count > 0) return
  const now = new Date().toISOString()
  const seeds = [
    { name: 'GLM (CN)', type: 'custom', url: 'https://open.bigmodel.cn/api/anthropic', key: 'sk-test-zhipu-123456', env: '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_AUTH_TOKEN":"","ANTHROPIC_MODEL":"glm-4.7","ANTHROPIC_DEFAULT_SONNET_MODEL":"glm-4.7","ANTHROPIC_DEFAULT_OPUS_MODEL":"glm-5","ANTHROPIC_DEFAULT_HAIKU_MODEL":"glm-4.5-air"}', active: 1 },
    { name: 'Kimi', type: 'custom', url: 'https://api.kimi.com/coding/', key: 'sk-test-kimi-abcdef', env: '{"ANTHROPIC_MODEL":"kimi-k2","ANTHROPIC_DEFAULT_SONNET_MODEL":"kimi-k2","ANTHROPIC_DEFAULT_OPUS_MODEL":"kimi-k2","ANTHROPIC_DEFAULT_HAIKU_MODEL":"kimi-k2"}', active: 0 },
    { name: 'OpenRouter', type: 'openrouter', url: 'https://openrouter.ai/api', key: 'sk-or-test-999888', env: '{"ANTHROPIC_API_KEY":""}', active: 0 },
    { name: 'MiniMax (CN)', type: 'custom', url: 'https://api.minimaxi.com/anthropic', key: 'sk-test-minimax-xyz', env: '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_AUTH_TOKEN":"","ANTHROPIC_MODEL":"MiniMax-M2.5","ANTHROPIC_DEFAULT_SONNET_MODEL":"MiniMax-M2.5","ANTHROPIC_DEFAULT_OPUS_MODEL":"MiniMax-M2.5","ANTHROPIC_DEFAULT_HAIKU_MODEL":"MiniMax-M2.5"}', active: 0 },
    { name: 'Volcengine Ark', type: 'custom', url: 'https://ark.cn-beijing.volces.com/api/coding', key: 'sk-test-volc-000111', env: '{"API_TIMEOUT_MS":"3000000","ANTHROPIC_AUTH_TOKEN":"","ANTHROPIC_MODEL":"ark-code-latest","ANTHROPIC_DEFAULT_SONNET_MODEL":"ark-code-latest","ANTHROPIC_DEFAULT_OPUS_MODEL":"ark-code-latest","ANTHROPIC_DEFAULT_HAIKU_MODEL":"ark-code-latest"}', active: 0 },
    { name: 'Aliyun Bailian', type: 'custom', url: 'https://coding.dashscope.aliyuncs.com/apps/anthropic', key: 'sk-test-bailian-abc', env: '{"ANTHROPIC_AUTH_TOKEN":"","ANTHROPIC_MODEL":"qwen3.5-plus","ANTHROPIC_DEFAULT_SONNET_MODEL":"qwen3.5-plus","ANTHROPIC_DEFAULT_OPUS_MODEL":"qwen3.5-plus","ANTHROPIC_DEFAULT_HAIKU_MODEL":"qwen3-coder-next"}', active: 0 },
    { name: 'AWS Bedrock', type: 'bedrock', url: '', key: '', env: '{"CLAUDE_CODE_USE_BEDROCK":"1","AWS_REGION":"us-east-1","AWS_ACCESS_KEY_ID":"","AWS_SECRET_ACCESS_KEY":"","AWS_SESSION_TOKEN":""}', active: 0 },
    { name: 'Google Vertex', type: 'vertex', url: '', key: '', env: '{"CLAUDE_CODE_USE_VERTEX":"1","CLOUD_ML_REGION":"global","ANTHROPIC_VERTEX_PROJECT_ID":"my-gcp-project"}', active: 0 },
  ]
  const stmt = db.prepare('INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  seeds.forEach((s, i) => stmt.run(randomUUID(), s.name, s.type, s.url, s.key, s.active, i, s.env, now, now))
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

export function getActiveProvider(): ApiProvider | undefined {
  return getDb().prepare('SELECT * FROM api_providers WHERE is_active = 1').get() as ApiProvider | undefined
}

export function getActiveProviderRaw(): ApiProvider | undefined {
  return getDb().prepare('SELECT * FROM api_providers WHERE is_active = 1').get() as ApiProvider | undefined
}

export function createProvider(data: CreateProviderRequest): ApiProvider {
  const now = new Date().toISOString()
  const id = randomUUID()
  const maxOrder = (getDb().prepare('SELECT MAX(sort_order) as m FROM api_providers').get() as { m: number | null })?.m ?? -1
  getDb().prepare(`
    INSERT INTO api_providers (id, name, provider_type, base_url, api_key, extra_env, notes, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.provider_type ?? 'anthropic',
    data.base_url ?? '',
    data.api_key ?? '',
    data.extra_env ?? '{}',
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
      name = ?, provider_type = ?, base_url = ?, ${skipApiKey ? '' : 'api_key = ?,'}
      extra_env = ?, notes = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    ...[
      data.name ?? existing.name,
      data.provider_type ?? existing.provider_type,
      data.base_url ?? existing.base_url,
      ...(skipApiKey ? [] : [data.api_key ?? existing.api_key]),
      data.extra_env ?? existing.extra_env,
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

export function activateProvider(id: string): boolean {
  const d = getDb()
  d.prepare('UPDATE api_providers SET is_active = 0').run()
  return d.prepare('UPDATE api_providers SET is_active = 1 WHERE id = ?').run(id).changes > 0
}

export function deactivateAllProviders(): void {
  getDb().prepare('UPDATE api_providers SET is_active = 0').run()
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
