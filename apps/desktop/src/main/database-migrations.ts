import { parseProviderModelEnv, type ProviderModelEnv } from '@superone/shared/agent-types'
import {
  foldOverridesIntoEndpoints,
  mergeExtraEnv,
  mergeModelMapping,
  PROTOCOL_FAMILIES,
  PROTOCOL_FAMILY,
  PROTOCOL_ORDER,
  type EndpointDefaults,
  type EndpointModel,
  type EndpointOverride,
  type Platform,
  type ProtocolFamily,
  type ServiceEndpoint,
  type WireProtocol,
} from '@superone/shared/platform-registry'
import { DRAFTS_TABLE_DDL } from '@superone/runtime/drafts'
import type Database from 'better-sqlite3'
import { encryptSecret } from './crypto/secret-store'

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
  if (!cols.some((c) => c.name === 'selected_model')) {
    db.exec('ALTER TABLE sessions ADD COLUMN selected_model TEXT')
  }
  if (!cols.some((c) => c.name === 'selected_effort')) {
    db.exec('ALTER TABLE sessions ADD COLUMN selected_effort TEXT')
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
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      platform_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      name TEXT NOT NULL,
      secret TEXT NOT NULL DEFAULT '',
      secret_env TEXT NOT NULL DEFAULT '',
      overrides_json TEXT NOT NULL DEFAULT '{}',
      notes TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS custom_platforms (
      id TEXT PRIMARY KEY,
      definition_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS consumer_bindings (
      consumer TEXT PRIMARY KEY,
      credential_id TEXT NOT NULL,
      endpoint_id TEXT,
      config_json TEXT NOT NULL DEFAULT '{}'
    );
  `)

  migrateLegacyApiProviders(db)
  migrateEndpointProtocols(db)
  migrateKimiMoonshotPlatforms(db)
  migrateCredentialEndpoints(db)

  db.exec(`
    CREATE TABLE IF NOT EXISTS harness_resource_cache (
      harness_id TEXT PRIMARY KEY,
      resources_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
  `)

  // Harness installation catalog (shared kernel: @superone/runtime/harness).
  // Same shape as apps/cli — intent + readiness; secrets by ref only.
  db.exec(`
    CREATE TABLE IF NOT EXISTS harness_installations (
      harness_id TEXT PRIMARY KEY NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'disabled',
      runtime_version TEXT,
      command TEXT,
      config_json TEXT,
      secret_ref TEXT,
      diagnostic_code TEXT,
      diagnostic_message TEXT,
      last_probed_at INTEGER,
      updated_at INTEGER NOT NULL
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

  // Local-environment drafts (same DDL the node runs — see @superone/runtime/drafts)
  // plus the outbox for drafts bound for a node we could not reach. Deliberately
  // no FK to projects: a draft outlives the project being removed and degrades
  // to "untargeted" instead of being cascade-deleted.
  db.exec(DRAFTS_TABLE_DDL)
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_drafts (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pending_drafts_connection ON pending_drafts(connection_id);
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
        api_provider_id TEXT,
        selected_model TEXT,
        selected_effort TEXT
      );
    `)
    db.exec(`
      INSERT INTO sessions_new (id, project_id, title, created_at, last_user_message_at, total_cost_usd, context_tokens, is_worktree, git_branch, is_pinned, provider, worktree_path, is_hidden, is_automation, automation_id, provider_id, provider_session_id, api_provider_id, selected_model, selected_effort)
      SELECT id, project_id, title, created_at, last_user_message_at, total_cost_usd, context_tokens, is_worktree, git_branch, is_pinned, provider, worktree_path, is_hidden, is_automation, automation_id, provider_id, provider_session_id, api_provider_id, selected_model, selected_effort
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
  if (!sessionColsPostRebuild.some((c) => c.name === 'acp_agent_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN acp_agent_id TEXT')
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
      created_at TEXT NOT NULL,
      upstream_task_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_media_gen_session ON media_generations(session_id);
    CREATE INDEX IF NOT EXISTS idx_media_gen_created ON media_generations(created_at DESC);
  `)

  // Video status is fetched on demand rather than tracked by a background poller, so the provider's
  // own task handle has to outlive the tool call that created it — without this column a `running`
  // row is unresolvable after the submitting call returns.
  const mediaGenCols = db.prepare('PRAGMA table_info(media_generations)').all() as Array<{ name: string }>
  if (!mediaGenCols.some((c) => c.name === 'upstream_task_id')) {
    db.exec('ALTER TABLE media_generations ADD COLUMN upstream_task_id TEXT')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_collaboration_grants (
      credential_hash TEXT PRIMARY KEY,
      credential_secret TEXT,
      credential_hint TEXT NOT NULL,
      parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      child_session_id TEXT UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      task TEXT NOT NULL,
      config_json TEXT NOT NULL,
      task_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_session_collaboration_parent
      ON session_collaboration_grants(parent_session_id);
    CREATE INDEX IF NOT EXISTS idx_session_collaboration_child
      ON session_collaboration_grants(child_session_id);

    CREATE TABLE IF NOT EXISTS session_collaboration_messages (
      id TEXT PRIMARY KEY,
      credential_hash TEXT NOT NULL REFERENCES session_collaboration_grants(credential_hash) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      sender_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      recipient_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      client_message_id TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      UNIQUE(credential_hash, sequence),
      UNIQUE(credential_hash, sender_session_id, client_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_collaboration_mailbox
      ON session_collaboration_messages(credential_hash, recipient_session_id, sequence);

    CREATE TABLE IF NOT EXISTS session_collaboration_cursors (
      credential_hash TEXT NOT NULL REFERENCES session_collaboration_grants(credential_hash) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      last_sequence INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(credential_hash, session_id)
    );
  `)
  const collaborationGrantCols = db.prepare('PRAGMA table_info(session_collaboration_grants)').all() as Array<{ name: string }>
  if (!collaborationGrantCols.some((column) => column.name === 'credential_secret')) {
    db.exec('ALTER TABLE session_collaboration_grants ADD COLUMN credential_secret TEXT')
  }
  if (!collaborationGrantCols.some((column) => column.name === 'kind')) {
    // spawn = create child (default, back-compat); link = mailbox with existing session
    db.exec(`ALTER TABLE session_collaboration_grants ADD COLUMN kind TEXT NOT NULL DEFAULT 'spawn'`)
  }
}

function seedBaseSessionProviders(db: Database.Database): void {
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO session_providers
      (id, harness_id, name, is_base, config_json, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)
  `)
  stmt.run('claude-base', 'claude', 'Claude (Base)', '{}', now, now)
  stmt.run('codex-base', 'codex', 'Codex (Base)', '{}', now, now)
  stmt.run('acp-base', 'acp', 'Others (ACP)', JSON.stringify({ agentId: 'grok-build' }), now, now)
  stmt.run('opencode-base', 'opencode', 'OpenCode (Base)', '{}', now, now)
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

export interface LegacyApiProviderRow {
  id: string
  name: string | null
  api_key: string | null
  notes: string | null
  sort_order: number | null
  supported_agents: string | null
  agent_configs: string | null
  is_active_claude: number | null
  is_active_codex: number | null
  agent_type: string | null
  base_url: string | null
  api_format: string | null
  extra_env: string | null
  created_at: string | null
  updated_at: string | null
}

export interface LegacyProviderMigration {
  platform: Platform
  bindings: Array<{ consumer: 'chat:claude' | 'chat:codex'; endpointId: string }>
}

interface LegacyAgentConfig {
  base_url?: string
  api_format?: string
  model_env?: unknown
  extra_env?: unknown
}

function legacyEndpointForFormat(apiFormat: string | undefined, agent: string): { protocol: WireProtocol; id: string } {
  switch (apiFormat || (agent === 'codex' ? 'openai_chat' : 'anthropic')) {
    case 'openai_responses':
      return { protocol: 'openai-responses', id: 'responses' }
    case 'openai_chat':
    case 'openai':
      return { protocol: 'openai-chat', id: 'chat' }
    default:
      return { protocol: 'anthropic-messages', id: 'messages' }
  }
}

function legacyModelMapping(raw: unknown): ProviderModelEnv {
  const text = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? JSON.stringify(raw) : '{}'
  return parseProviderModelEnv(text)
}

function legacyStringRecord(raw: unknown): Record<string, string> {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw || '{}')
    } catch {
      obj = {}
    }
  }
  const out: Record<string, string> = {}
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
  }
  return out
}

function normalizeLegacyAgents(row: LegacyApiProviderRow): string[] {
  const parsed = safeParse<unknown>(row.supported_agents || '[]', [])
  const list = Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : []
  return list.length > 0 ? list : [row.agent_type || 'claude']
}

function normalizeLegacyAgentConfigs(
  row: LegacyApiProviderRow,
  agents: string[],
): Record<string, LegacyAgentConfig> {
  const parsed = safeParse<Record<string, LegacyAgentConfig>>(row.agent_configs || '{}', {})
  if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return parsed
  const agent = agents[0] || 'claude'
  return {
    [agent]: {
      base_url: row.base_url || '',
      api_format: row.api_format || (agent === 'codex' ? 'openai_chat' : 'anthropic'),
      extra_env: row.extra_env || '{}',
    },
  }
}

export function buildLegacyProviderMigration(row: LegacyApiProviderRow): LegacyProviderMigration | null {
  const agents = normalizeLegacyAgents(row)
  const agentConfigs = normalizeLegacyAgentConfigs(row, agents)

  const endpoints: ServiceEndpoint[] = []
  const bindings: LegacyProviderMigration['bindings'] = []
  const usedEndpointIds = new Set<string>()

  for (const agent of agents) {
    const ac = agentConfigs[agent]
    if (!ac) continue
    const { protocol, id } = legacyEndpointForFormat(ac.api_format, agent)
    let endpointId = id
    let n = 2
    while (usedEndpointIds.has(endpointId)) endpointId = `${id}-${n++}`
    usedEndpointIds.add(endpointId)

    const defaults: EndpointDefaults = {}
    const modelMapping = legacyModelMapping(ac.model_env)
    const extraEnv = legacyStringRecord(ac.extra_env)
    if (Object.keys(modelMapping).length > 0) defaults.modelMapping = modelMapping
    if (Object.keys(extraEnv).length > 0) defaults.extraEnv = extraEnv

    const endpoint: ServiceEndpoint = { id: endpointId, baseUrl: ac.base_url || '', protocols: [protocol] }
    if (Object.keys(defaults).length > 0) endpoint.defaults = defaults
    endpoints.push(endpoint)

    const isActive = agent === 'codex' ? row.is_active_codex : row.is_active_claude
    if (isActive) bindings.push({ consumer: agent === 'codex' ? 'chat:codex' : 'chat:claude', endpointId })
  }

  if (endpoints.length === 0) return null

  const platform: Platform = {
    id: `custom:${row.id}`,
    brand: 'custom',
    name: row.name || 'Provider',
    plans: [{ id: 'api', name: 'API', auth: 'api-key', endpoints }],
  }
  return { platform, bindings }
}

function migrateLegacyApiProviders(db: Database.Database): void {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_providers'").get()
  if (!exists) return

  const rows = db.prepare('SELECT * FROM api_providers').all() as LegacyApiProviderRow[]
  const insertPlatform = db.prepare(
    'INSERT OR IGNORE INTO custom_platforms (id, definition_json, created_at, updated_at) VALUES (?, ?, ?, ?)',
  )
  const insertCredential = db.prepare(
    `INSERT OR IGNORE INTO credentials
       (id, platform_id, plan_id, name, secret, secret_env, overrides_json, notes, sort_order, created_at, updated_at)
     VALUES (?, ?, 'api', ?, ?, '', '{}', ?, ?, ?, ?)`,
  )
  const insertBinding = db.prepare(
    "INSERT OR IGNORE INTO consumer_bindings (consumer, credential_id, endpoint_id, config_json) VALUES (?, ?, ?, '{}')",
  )

  for (const row of rows) {
    const result = buildLegacyProviderMigration(row)
    if (!result) continue
    const now = new Date().toISOString()
    const createdAt = row.created_at || now
    const updatedAt = row.updated_at || now
    insertPlatform.run(result.platform.id, JSON.stringify(result.platform), createdAt, updatedAt)
    insertCredential.run(
      row.id,
      result.platform.id,
      result.platform.name,
      encryptSecret(row.api_key || ''),
      row.notes || '',
      row.sort_order ?? 0,
      createdAt,
      updatedAt,
    )
    for (const b of result.bindings) insertBinding.run(b.consumer, row.id, b.endpointId)
  }

  db.exec('DROP TABLE IF EXISTS api_providers')
}

// --- endpoint protocols model (protocol → protocols[], baseUrl per addressable service) --------
// Collapses the pre-protocols[] endpoint model into one endpoint per protocol family (id = family
// name), migrating persisted custom platforms, credential overrides, and consumer bindings in place.
// Idempotent: already-migrated data regroups to itself, and rows are only rewritten when they change.

export interface OldServiceEndpoint {
  id: string
  baseUrl: string
  protocol?: WireProtocol // pre-migration single protocol
  protocols?: WireProtocol[] // post-migration
  models?: EndpointModel[]
  defaults?: EndpointDefaults
}

// Endpoint id remap for the builtin `openai` media platform, whose images/responses/audio endpoints
// collapse into a single `openai` endpoint. Scoped to platform_id = 'openai' so it never touches
// the `openai-official` platform (which keeps its own `responses` endpoint).
const OPENAI_BUILTIN_REMAP: Record<string, string> = { images: 'openai', responses: 'openai', audio: 'openai' }

function mergeOverride(a: EndpointOverride, b: EndpointOverride): EndpointOverride {
  const out: EndpointOverride = {}
  const baseUrl = b.baseUrl ?? a.baseUrl
  if (baseUrl) out.baseUrl = baseUrl
  const models = [...(a.models ?? []), ...(b.models ?? [])]
  const byId = new Map<string, EndpointModel>()
  for (const m of models) byId.set(m.id, m)
  if (byId.size > 0) out.models = [...byId.values()]
  const extraEnv = mergeExtraEnv(a.extraEnv, b.extraEnv)
  if (Object.keys(extraEnv).length > 0) out.extraEnv = extraEnv
  const modelMapping = mergeModelMapping(a.modelMapping, b.modelMapping)
  if (Object.keys(modelMapping).length > 0) out.modelMapping = modelMapping
  return out
}

export function remapOverrides(
  overrides: Record<string, EndpointOverride>,
  remap: Record<string, string>,
): Record<string, EndpointOverride> {
  const out: Record<string, EndpointOverride> = {}
  for (const [oldId, ov] of Object.entries(overrides)) {
    const newId = remap[oldId] ?? oldId
    out[newId] = out[newId] ? mergeOverride(out[newId], ov) : ov
  }
  return out
}

// Regroup a plan's endpoints by protocol family into one endpoint each (id = family), returning the
// rebuilt endpoints and the old→new id remap. Defaults/models merge across a collapsed family.
export function regroupPlanEndpoints(oldEndpoints: OldServiceEndpoint[]): {
  endpoints: ServiceEndpoint[]
  remap: Record<string, string>
} {
  const groups = new Map<
    ProtocolFamily,
    { protocols: Set<WireProtocol>; baseUrl: string; models: EndpointModel[]; defaults: EndpointDefaults; ids: string[] }
  >()
  for (const e of oldEndpoints) {
    const protocols = e.protocols ?? (e.protocol ? [e.protocol] : [])
    if (protocols.length === 0) continue
    const family = PROTOCOL_FAMILY[protocols[0]]
    const g = groups.get(family) ?? { protocols: new Set(), baseUrl: '', models: [], defaults: {}, ids: [] }
    for (const p of protocols) g.protocols.add(p)
    if (!g.baseUrl) g.baseUrl = e.baseUrl
    if (e.models) g.models.push(...e.models)
    if (e.defaults?.modelMapping) g.defaults.modelMapping = mergeModelMapping(g.defaults.modelMapping, e.defaults.modelMapping)
    if (e.defaults?.extraEnv) g.defaults.extraEnv = mergeExtraEnv(g.defaults.extraEnv, e.defaults.extraEnv)
    g.ids.push(e.id)
    groups.set(family, g)
  }
  const endpoints: ServiceEndpoint[] = []
  const remap: Record<string, string> = {}
  for (const family of PROTOCOL_FAMILIES) {
    const g = groups.get(family)
    if (!g) continue
    const protocols = [...g.protocols].sort((a, b) => PROTOCOL_ORDER.indexOf(a) - PROTOCOL_ORDER.indexOf(b))
    const endpoint: ServiceEndpoint = { id: family, baseUrl: g.baseUrl, protocols }
    if (g.models.length > 0) endpoint.models = g.models
    if (g.defaults.modelMapping || g.defaults.extraEnv) endpoint.defaults = g.defaults
    endpoints.push(endpoint)
    for (const oldId of g.ids) remap[oldId] = family
  }
  return { endpoints, remap }
}

function migrateEndpointProtocols(db: Database.Database): void {
  const now = new Date().toISOString()
  // platform_id → (old endpoint id → new endpoint id), used to remap credentials & bindings.
  const platformRemap = new Map<string, Record<string, string>>()
  platformRemap.set('openai', OPENAI_BUILTIN_REMAP)

  const platforms = db.prepare('SELECT id, definition_json FROM custom_platforms').all() as Array<{
    id: string
    definition_json: string
  }>
  const updatePlatform = db.prepare('UPDATE custom_platforms SET definition_json = ?, updated_at = ? WHERE id = ?')
  for (const row of platforms) {
    let platform: Platform
    try {
      platform = JSON.parse(row.definition_json) as Platform
    } catch {
      continue
    }
    const remap: Record<string, string> = {}
    let changed = false
    for (const plan of platform.plans) {
      const oldEndpoints = plan.endpoints as unknown as OldServiceEndpoint[]
      const { endpoints, remap: planRemap } = regroupPlanEndpoints(oldEndpoints)
      Object.assign(remap, planRemap)
      if (JSON.stringify(plan.endpoints) !== JSON.stringify(endpoints)) changed = true
      plan.endpoints = endpoints
    }
    if (Object.keys(remap).length > 0) platformRemap.set(platform.id, remap)
    if (changed) updatePlatform.run(JSON.stringify(platform), now, row.id)
  }

  const credentials = db.prepare('SELECT id, platform_id, overrides_json FROM credentials').all() as Array<{
    id: string
    platform_id: string
    overrides_json: string
  }>
  const updateCredential = db.prepare('UPDATE credentials SET overrides_json = ?, updated_at = ? WHERE id = ?')
  const credPlatform = new Map<string, string>()
  for (const row of credentials) {
    credPlatform.set(row.id, row.platform_id)
    const remap = platformRemap.get(row.platform_id)
    if (!remap) continue
    let overrides: Record<string, EndpointOverride>
    try {
      overrides = JSON.parse(row.overrides_json) as Record<string, EndpointOverride>
    } catch {
      continue
    }
    const next = remapOverrides(overrides, remap)
    if (JSON.stringify(overrides) !== JSON.stringify(next)) updateCredential.run(JSON.stringify(next), now, row.id)
  }

  const bindings = db.prepare('SELECT consumer, credential_id, endpoint_id FROM consumer_bindings').all() as Array<{
    consumer: string
    credential_id: string
    endpoint_id: string | null
  }>
  const updateBinding = db.prepare('UPDATE consumer_bindings SET endpoint_id = ? WHERE consumer = ?')
  for (const row of bindings) {
    if (!row.endpoint_id) continue
    const platformId = credPlatform.get(row.credential_id)
    const remap = platformId ? platformRemap.get(platformId) : undefined
    const next = remap?.[row.endpoint_id]
    if (next && next !== row.endpoint_id) updateBinding.run(next, row.consumer)
  }
}

// kimi-cn / kimi-global → kimi (membership tiers) + moonshot (cn | global).
// Legacy coding settings match Allegretto+ (k3[1m] + 1M context + HighSpeed).
function migrateKimiMoonshotPlatforms(db: Database.Database): void {
  const now = new Date().toISOString()
  const update = db.prepare(
    `UPDATE credentials SET platform_id = ?, plan_id = ?, updated_at = ?
     WHERE platform_id = ? AND plan_id = ?`,
  )
  const remaps: Array<{ fromPlatform: string; fromPlan: string; toPlatform: string; toPlan: string }> = [
    { fromPlatform: 'kimi-cn', fromPlan: 'coding', toPlatform: 'kimi', toPlan: 'allegretto' },
    { fromPlatform: 'kimi-global', fromPlan: 'coding', toPlatform: 'kimi', toPlan: 'allegretto' },
    { fromPlatform: 'kimi', fromPlan: 'coding', toPlatform: 'kimi', toPlan: 'allegretto' },
    { fromPlatform: 'kimi-cn', fromPlan: 'api', toPlatform: 'moonshot', toPlan: 'cn' },
    { fromPlatform: 'kimi-global', fromPlan: 'api', toPlatform: 'moonshot', toPlan: 'global' },
  ]
  for (const r of remaps) {
    update.run(r.toPlatform, r.toPlan, now, r.fromPlatform, r.fromPlan)
  }
}

/**
 * Custom platforms: promote plan.endpoints (+ per-key overrides) into credentials.endpoints_json
 * so each key owns its full endpoint list. Idempotent.
 */
function migrateCredentialEndpoints(db: Database.Database): void {
  const credCols = db.prepare('PRAGMA table_info(credentials)').all() as Array<{ name: string }>
  if (!credCols.some((c) => c.name === 'endpoints_json')) {
    db.exec('ALTER TABLE credentials ADD COLUMN endpoints_json TEXT')
  }

  const platforms = db.prepare('SELECT id, definition_json FROM custom_platforms').all() as Array<{
    id: string
    definition_json: string
  }>
  const platformById = new Map<string, Platform>()
  for (const row of platforms) {
    try {
      const p = JSON.parse(row.definition_json) as Platform
      platformById.set(row.id, p)
    } catch {
      // skip corrupt rows
    }
  }

  const creds = db
    .prepare(
      `SELECT id, platform_id, plan_id, overrides_json, endpoints_json FROM credentials WHERE platform_id LIKE 'custom:%'`,
    )
    .all() as Array<{
    id: string
    platform_id: string
    plan_id: string
    overrides_json: string
    endpoints_json: string | null
  }>

  const update = db.prepare(
    `UPDATE credentials SET endpoints_json = ?, updated_at = ? WHERE id = ?`,
  )
  const now = new Date().toISOString()

  for (const row of creds) {
    if (row.endpoints_json) {
      try {
        const existing = JSON.parse(row.endpoints_json) as unknown
        if (Array.isArray(existing) && existing.length > 0) continue
      } catch {
        // rewrite below
      }
    }
    const platform = platformById.get(row.platform_id)
    const plan = platform?.plans.find((p) => p.id === row.plan_id) ?? platform?.plans[0]
    if (!plan?.endpoints?.length) continue
    let overrides: Record<string, EndpointOverride> = {}
    try {
      overrides = JSON.parse(row.overrides_json || '{}') as Record<string, EndpointOverride>
    } catch {
      overrides = {}
    }
    const endpoints = foldOverridesIntoEndpoints(plan.endpoints, overrides)
    update.run(JSON.stringify(endpoints), now, row.id)
  }
}
