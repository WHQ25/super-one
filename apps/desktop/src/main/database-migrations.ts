import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type { ApiProvider, ProviderCapability } from '@superone/shared/agent-types'
import { agentConfigsToCapabilities, MEDIA_KIND_TO_CAPABILITY_PROTOCOL } from '@superone/shared/provider-utils'
import { encryptSecret, isEncryptedSecret } from './crypto/secret-store'
import { readMediaGenForMigration } from './media-gen/migration'

export function runDatabaseMigrations(db: Database.Database): void {
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
      last_user_message_at TEXT,
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

    CREATE TABLE IF NOT EXISTS browser_history (
      url TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      visit_count INTEGER NOT NULL DEFAULT 1,
      last_visit INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_browser_history_last_visit ON browser_history(last_visit DESC);

  `)

  db.exec('DROP INDEX IF EXISTS idx_chat_messages_session')
  db.exec('DROP INDEX IF EXISTS idx_chat_messages_last_user')

  db.exec('DROP TABLE IF EXISTS init_cache')

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
  if (!cols.some((c) => c.name === 'last_user_message_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN last_user_message_at TEXT')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project_last_user ON sessions(project_id, last_user_message_at DESC)')

  const msgCols = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>
  if (!msgCols.some((c) => c.name === 'checkpoint_id')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN checkpoint_id TEXT')
  }
  if (!msgCols.some((c) => c.name === 'resume_point_id')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN resume_point_id TEXT')
  }

  const hasLegacyClaudeSessionCol = cols.some((c) => c.name === 'claude_session_id')
  const hasLegacyMsgClaudeSessionCol = msgCols.some((c) => c.name === 'claude_session_id')

  if (hasLegacyClaudeSessionCol && hasLegacyMsgClaudeSessionCol) {
    db.exec(`
      UPDATE sessions
      SET last_user_message_at = COALESCE(
        (
          SELECT MAX(m.created_at)
          FROM chat_messages m
          WHERE m.claude_session_id = sessions.claude_session_id
            AND m.role = 'user'
        ),
        created_at
      )
      WHERE last_user_message_at IS NULL
    `)

    db.exec(`
      UPDATE sessions
      SET provider = 'codex'
      WHERE claude_session_id LIKE 'codex_local_%'
         OR EXISTS (
           SELECT 1
           FROM chat_messages m
           WHERE m.claude_session_id = sessions.claude_session_id
             AND m.provider_id = 'codex'
         )
    `)
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
  if (!provCols.some((c) => c.name === 'api_key_env')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN api_key_env TEXT NOT NULL DEFAULT ''")
  }
  if (!provCols.some((c) => c.name === 'capabilities')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]'")
  }
  if (!provCols.some((c) => c.name === 'key_name')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN key_name TEXT NOT NULL DEFAULT ''")
  }

  migrateProvidersToUnified(db)
  migrateModelEnvToStructured(db)
  migrateAgentConfigsToCapabilities(db)
  migrateApiKeysToEncrypted(db)

  db.exec(`
    CREATE TABLE IF NOT EXISTS harness_resource_cache (
      harness_id TEXT PRIMARY KEY,
      resources_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
  `)

  migrateGlobalResourceCacheToHarness(db)

  db.exec(`
    CREATE TABLE IF NOT EXISTS paired_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      paired_at TEXT NOT NULL,
      last_seen_at TEXT
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      agent_config_json TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      last_run_status TEXT,
      last_run_session_id TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id);
    CREATE INDEX IF NOT EXISTS idx_automations_next_run ON automations(enabled, next_run_at);
  `)

  if (!cols.some((c) => c.name === 'is_automation')) {
    db.exec('ALTER TABLE sessions ADD COLUMN is_automation INTEGER DEFAULT 0')
  }
  if (!cols.some((c) => c.name === 'automation_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN automation_id TEXT')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_providers (
      id          TEXT PRIMARY KEY,
      harness_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      is_base     INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_providers_harness ON session_providers(harness_id);
  `)

  const spCols = db.prepare("PRAGMA table_info(session_providers)").all() as Array<{ name: string }>
  if (spCols.some((c) => c.name === 'is_official') && !spCols.some((c) => c.name === 'is_base')) {
    db.exec('ALTER TABLE session_providers RENAME COLUMN is_official TO is_base')
  }
  db.exec("UPDATE session_providers SET id = 'claude-base' WHERE id = 'claude-official'")
  db.exec("UPDATE session_providers SET id = 'codex-base' WHERE id = 'codex-official'")

  seedBaseSessionProviders(db)

  const sessionColsAfterSeed = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
  if (!sessionColsAfterSeed.some((c) => c.name === 'provider_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN provider_id TEXT')
  }
  if (!sessionColsAfterSeed.some((c) => c.name === 'provider_session_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN provider_session_id TEXT')
  }
  if (!sessionColsAfterSeed.some((c) => c.name === 'api_provider_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN api_provider_id TEXT')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_provider_session_id ON sessions(provider_session_id)')

  db.exec("UPDATE sessions SET provider_id = 'claude-base' WHERE provider_id = 'claude-official'")
  db.exec("UPDATE sessions SET provider_id = 'codex-base' WHERE provider_id = 'codex-official'")

  db.exec(`
    UPDATE sessions
    SET provider_id = CASE WHEN provider = 'codex' THEN 'codex-base' ELSE 'claude-base' END
    WHERE provider_id IS NULL
  `)

  if (hasLegacyClaudeSessionCol) {
    db.exec(`
      UPDATE sessions
      SET provider_session_id = CASE
        WHEN claude_session_id LIKE 'codex_local_%' THEN NULL
        ELSE claude_session_id
      END
      WHERE provider_session_id IS NULL
    `)
  }

  const chatMsgColsAfterSeed = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>
  if (!chatMsgColsAfterSeed.some((c) => c.name === 'session_id')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN session_id TEXT')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_chat_messages_session_v2 ON chat_messages(session_id, sort_order)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_chat_messages_last_user_v2 ON chat_messages(session_id, role, created_at)')

  if (hasLegacyClaudeSessionCol && hasLegacyMsgClaudeSessionCol) {
    db.exec(`
      UPDATE chat_messages
      SET session_id = (
        SELECT s.id FROM sessions s WHERE s.claude_session_id = chat_messages.claude_session_id
      )
      WHERE session_id IS NULL
    `)
  }

  const chatMsgColsFinal = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>
  const sessionColsPreDrop = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
  const needsRebuild = chatMsgColsFinal.some((c) => c.name === 'claude_session_id')
    || sessionColsPreDrop.some((c) => c.name === 'claude_session_id')
  if (needsRebuild) db.pragma('foreign_keys = OFF')
  if (chatMsgColsFinal.some((c) => c.name === 'claude_session_id')) {
    db.exec(`
      CREATE TABLE chat_messages_new (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        metadata_json TEXT,
        checkpoint_id TEXT,
        resume_point_id TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `)
    db.exec(`
      INSERT INTO chat_messages_new (id, session_id, sort_order, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id)
      SELECT id, session_id, sort_order, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id
      FROM chat_messages
      WHERE session_id IS NOT NULL
    `)
    db.exec('DROP TABLE chat_messages')
    db.exec('ALTER TABLE chat_messages_new RENAME TO chat_messages')
    db.exec('CREATE INDEX IF NOT EXISTS idx_chat_messages_session_v2 ON chat_messages(session_id, sort_order)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_chat_messages_last_user_v2 ON chat_messages(session_id, role, created_at)')
  }
  const sessionColsFinal = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
  if (sessionColsFinal.some((c) => c.name === 'claude_session_id')) {
    db.exec(`
      CREATE TABLE sessions_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT,
        created_at TEXT NOT NULL,
        last_user_message_at TEXT,
        total_cost_usd REAL DEFAULT 0,
        context_tokens INTEGER DEFAULT 0,
        is_worktree INTEGER DEFAULT 0,
        git_branch TEXT,
        is_pinned INTEGER DEFAULT 0,
        provider TEXT DEFAULT 'claude',
        worktree_path TEXT,
        is_hidden INTEGER DEFAULT 0,
        is_automation INTEGER DEFAULT 0,
        automation_id TEXT,
        provider_id TEXT,
        provider_session_id TEXT,
        api_provider_id TEXT
      );
    `)
    db.exec(`
      INSERT INTO sessions_new (id, project_id, title, created_at, last_user_message_at, total_cost_usd, context_tokens, is_worktree, git_branch, is_pinned, provider, worktree_path, is_hidden, is_automation, automation_id, provider_id, provider_session_id, api_provider_id)
      SELECT id, project_id, title, created_at, last_user_message_at, total_cost_usd, context_tokens, is_worktree, git_branch, is_pinned, provider, worktree_path, is_hidden, is_automation, automation_id, provider_id, provider_session_id, api_provider_id
      FROM sessions
    `)
    db.exec('DROP TABLE sessions')
    db.exec('ALTER TABLE sessions_new RENAME TO sessions')
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project_last_user ON sessions(project_id, last_user_message_at DESC)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider_id)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_provider_session_id ON sessions(provider_session_id)')
  }
  if (needsRebuild) db.pragma('foreign_keys = ON')

  const sessionColsPostRebuild = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
  if (!sessionColsPostRebuild.some((c) => c.name === 'usage_counted_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN usage_counted_at TEXT')
  }
  if (!sessionColsPostRebuild.some((c) => c.name === 'is_user_renamed')) {
    db.exec('ALTER TABLE sessions ADD COLUMN is_user_renamed INTEGER DEFAULT 0')
  }
  const msgColsPostRebuild = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>
  if (!msgColsPostRebuild.some((c) => c.name === 'usage_counted_at')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN usage_counted_at TEXT')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_daily (
      day TEXT NOT NULL,
      harness TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, harness, model)
    );
    CREATE INDEX IF NOT EXISTS idx_usage_daily_day ON usage_daily(day DESC);

    CREATE TABLE IF NOT EXISTS activity_daily (
      day TEXT NOT NULL,
      harness TEXT NOT NULL,
      sessions_started INTEGER NOT NULL DEFAULT 0,
      user_messages INTEGER NOT NULL DEFAULT 0,
      assistant_messages INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, harness)
    );
    CREATE INDEX IF NOT EXISTS idx_activity_daily_day ON activity_daily(day DESC);

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS media_generations (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_id TEXT,
      source TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'image',
      prompt TEXT NOT NULL,
      params_json TEXT NOT NULL DEFAULT '{}',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      result_paths_json TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_gen_session ON media_generations(session_id);
    CREATE INDEX IF NOT EXISTS idx_media_gen_created ON media_generations(created_at DESC);
  `)

  migrateMediaGenToProviders(db)
}

function seedBaseSessionProviders(db: Database.Database): void {
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO session_providers
      (id, harness_id, name, is_base, config_json, created_at, updated_at)
    VALUES (?, ?, ?, 1, '{}', ?, ?)
  `)
  stmt.run('claude-base', 'claude', 'Claude (Base)', now, now)
  stmt.run('codex-base', 'codex', 'Codex (Base)', now, now)
}

const FLAT_TO_BUCKET: Record<string, 'default' | 'opus' | 'sonnet' | 'haiku' | 'subagent'> = {
  ANTHROPIC_MODEL: 'default',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'opus',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'haiku',
  CLAUDE_CODE_SUBAGENT_MODEL: 'subagent',
}

function hasStructuredShape(obj: Record<string, unknown>): boolean {
  for (const bucket of ['default', 'opus', 'sonnet', 'haiku', 'subagent']) {
    const v = obj[bucket]
    if (v && typeof v === 'object' && 'id' in (v as object)) return true
  }
  return false
}

function migrateModelEnvToStructured(db: Database.Database): void {
  const rows = db.prepare('SELECT id, agent_configs FROM api_providers').all() as Array<{ id: string; agent_configs: string }>
  if (rows.length === 0) return
  const stmt = db.prepare('UPDATE api_providers SET agent_configs = ? WHERE id = ?')
  for (const row of rows) {
    let configs: Record<string, { base_url: string; model_env: string; extra_env: string; api_format: string }>
    try {
      configs = JSON.parse(row.agent_configs || '{}')
    } catch {
      continue
    }
    let changed = false
    for (const [agent, ac] of Object.entries(configs)) {
      if (!ac || typeof ac !== 'object') continue
      let modelEnvObj: Record<string, unknown> = {}
      try {
        modelEnvObj = JSON.parse(ac.model_env || '{}')
      } catch {
        modelEnvObj = {}
      }
      let extraEnvObj: Record<string, string> = {}
      try {
        extraEnvObj = JSON.parse(ac.extra_env || '{}')
      } catch {
        extraEnvObj = {}
      }

      if (hasStructuredShape(modelEnvObj)) continue

      const structured: Record<string, { id: string; name?: string }> = {}
      for (const [flatKey, bucket] of Object.entries(FLAT_TO_BUCKET)) {
        const fromModel = typeof modelEnvObj[flatKey] === 'string' ? (modelEnvObj[flatKey] as string) : ''
        const fromExtra = typeof extraEnvObj[flatKey] === 'string' ? extraEnvObj[flatKey] : ''
        const id = fromModel || fromExtra
        if (id) {
          structured[bucket] = { id }
        }
        if (flatKey in extraEnvObj) {
          delete extraEnvObj[flatKey]
          changed = true
        }
      }

      if (Object.keys(structured).length > 0 || Object.keys(modelEnvObj).length > 0) {
        configs[agent] = {
          ...ac,
          model_env: JSON.stringify(structured),
          extra_env: JSON.stringify(extraEnvObj),
        }
        changed = true
      }
    }
    if (changed) {
      stmt.run(JSON.stringify(configs), row.id)
    }
  }
}

function migrateGlobalResourceCacheToHarness(db: Database.Database): void {
  const legacyExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='global_resource_cache'")
    .get()
  if (!legacyExists) return

  const hasCodexColumn = (
    db.prepare('PRAGMA table_info(global_resource_cache)').all() as Array<{ name: string }>
  ).some((c) => c.name === 'codex_models_json')

  const row = db
    .prepare(
      `SELECT models_json, ${hasCodexColumn ? 'codex_models_json' : "'[]' AS codex_models_json"}, account_json, slash_commands_json FROM global_resource_cache WHERE id = 1`,
    )
    .get() as
    | { models_json: string; codex_models_json: string; account_json: string; slash_commands_json: string }
    | undefined

  if (row) {
    const claudeResources = {
      models: safeParse(row.models_json, []),
      account: safeParse(row.account_json, {}),
      slashCommands: safeParse(row.slash_commands_json, []),
      skills: [],
      commands: [],
      agents: [],
      outputStyles: [],
    }
    const codexResources = {
      models: safeParse(row.codex_models_json, []),
    }
    const now = new Date().toISOString()
    const upsert = db.prepare(`
      INSERT INTO harness_resource_cache (harness_id, resources_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(harness_id) DO UPDATE SET
        resources_json = excluded.resources_json,
        updated_at = excluded.updated_at
    `)
    upsert.run('claude', JSON.stringify(claudeResources), now)
    upsert.run('codex', JSON.stringify(codexResources), now)
  }

  db.exec('DROP TABLE global_resource_cache')
}

function safeParse<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T
  } catch {
    return fallback
  }
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
    const isActiveClaude = agentType === 'claude' ? (row.is_active ?? 0) : 0
    const isActiveCodex = agentType === 'codex' ? (row.is_active ?? 0) : 0
    stmt.run(supportedAgents, agentConfigs, isActiveClaude, isActiveCodex, row.id)
  }
}

/** Backfill unified `capabilities` from legacy `agent_configs`. Idempotent: skips rows that already have capabilities. */
function migrateAgentConfigsToCapabilities(db: Database.Database): void {
  const rows = db.prepare('SELECT id, agent_configs, capabilities FROM api_providers').all() as Array<{
    id: string
    agent_configs: string
    capabilities: string
  }>
  if (rows.length === 0) return
  const stmt = db.prepare('UPDATE api_providers SET capabilities = ? WHERE id = ?')
  for (const row of rows) {
    if (safeParse<unknown[]>(row.capabilities || '[]', []).length > 0) continue
    const caps = agentConfigsToCapabilities(row.agent_configs)
    if (caps.length === 0) continue
    stmt.run(JSON.stringify(caps), row.id)
  }
}

/** Encrypt plaintext `api_key` values at rest. Idempotent: already-encrypted values are skipped. */
function migrateApiKeysToEncrypted(db: Database.Database): void {
  const rows = db.prepare('SELECT id, api_key FROM api_providers').all() as Array<{ id: string; api_key: string }>
  if (rows.length === 0) return
  const stmt = db.prepare('UPDATE api_providers SET api_key = ? WHERE id = ?')
  for (const row of rows) {
    if (!row.api_key || isEncryptedSecret(row.api_key)) continue
    stmt.run(encryptSecret(row.api_key), row.id)
  }
}

/** One-time: fold legacy media-gen JSON providers into `api_providers` with an image capability. Guarded by an app_meta flag. */
function migrateMediaGenToProviders(db: Database.Database): void {
  const flag = db.prepare("SELECT value FROM app_meta WHERE key = 'media_gen_migrated'").get() as { value: string } | undefined
  if (flag) return

  let legacy: ReturnType<typeof readMediaGenForMigration> = []
  try {
    legacy = readMediaGenForMigration()
  } catch {
    legacy = []
  }

  const now = new Date().toISOString()
  const maxOrder = (db.prepare('SELECT MAX(sort_order) as m FROM api_providers').get() as { m: number | null })?.m ?? -1
  const insert = db.prepare(`
    INSERT INTO api_providers (id, name, provider_type, api_key, api_key_env, category, supported_agents, agent_configs, capabilities, sort_order, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  legacy.forEach((entry, index) => {
    const protocol = MEDIA_KIND_TO_CAPABILITY_PROTOCOL[entry.kind] ?? 'openai-compatible-image'
    const capability: ProviderCapability = {
      id: `image-${entry.id}`,
      task: 'image',
      protocol,
      enabled: true,
      baseUrl: entry.baseURL || undefined,
      models: entry.models,
    }
    insert.run(
      randomUUID(),
      entry.name,
      'custom',
      entry.apiKey ? encryptSecret(entry.apiKey) : '',
      entry.apiKeyEnv ?? '',
      'custom',
      '[]',
      '{}',
      JSON.stringify([capability]),
      maxOrder + 1 + index,
      '',
      now,
      now,
    )
  })

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('media_gen_migrated', ?)").run(now)
}
