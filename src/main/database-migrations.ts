import type Database from 'better-sqlite3'
import type { ApiProvider } from '../shared/agent-types'

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

  migrateProvidersToUnified(db)

  db.exec(`
    CREATE TABLE IF NOT EXISTS global_resource_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      models_json TEXT NOT NULL,
      codex_models_json TEXT NOT NULL DEFAULT '[]',
      account_json TEXT NOT NULL,
      slash_commands_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  const cacheCols = db.prepare("PRAGMA table_info(global_resource_cache)").all() as Array<{ name: string }>
  if (!cacheCols.some((c) => c.name === 'codex_models_json')) {
    db.exec("ALTER TABLE global_resource_cache ADD COLUMN codex_models_json TEXT NOT NULL DEFAULT '[]'")
  }

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
        provider_session_id TEXT
      );
    `)
    db.exec(`
      INSERT INTO sessions_new (id, project_id, title, created_at, last_user_message_at, total_cost_usd, context_tokens, is_worktree, git_branch, is_pinned, provider, worktree_path, is_hidden, is_automation, automation_id, provider_id, provider_session_id)
      SELECT id, project_id, title, created_at, last_user_message_at, total_cost_usd, context_tokens, is_worktree, git_branch, is_pinned, provider, worktree_path, is_hidden, is_automation, automation_id, provider_id, provider_session_id
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
