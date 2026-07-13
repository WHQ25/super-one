import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => {
  const exec = vi.fn()
  const pragma = vi.fn()
  const prepare = vi.fn((sql: string) => {
    if (sql === 'PRAGMA table_info(sessions)') {
      return {
        all: () => [
          { name: 'id' },
          { name: 'project_id' },
          { name: 'claude_session_id' },
          { name: 'title' },
          { name: 'created_at' },
          { name: 'total_cost_usd' },
          { name: 'context_tokens' },
          { name: 'provider' },
        ],
      }
    }
    if (sql === 'PRAGMA table_info(chat_messages)') {
      return {
        all: () => [
          { name: 'id' },
          { name: 'claude_session_id' },
          { name: 'sort_order' },
          { name: 'role' },
          { name: 'status' },
          { name: 'content_json' },
          { name: 'created_at' },
          { name: 'provider_id' },
          { name: 'metadata_json' },
        ],
      }
    }
    if (sql === 'PRAGMA table_info(api_providers)') {
      return { all: () => [] }
    }
    if (sql === 'PRAGMA table_info(global_resource_cache)') {
      return { all: () => [] }
    }
    if (sql === 'SELECT * FROM api_providers WHERE agent_configs = \'{}\'') {
      return { all: () => [] }
    }
    return { all: () => [], get: () => undefined, run: vi.fn() }
  })
  return { exec, pragma, prepare }
})

const DatabaseCtor = vi.hoisted(() => vi.fn(function MockDatabase() {
  return dbMock
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('better-sqlite3', () => ({ default: DatabaseCtor }))

describe('database migration', () => {
  beforeEach(() => {
    vi.resetModules()
    DatabaseCtor.mockClear()
    dbMock.exec.mockClear()
    dbMock.pragma.mockClear()
    dbMock.prepare.mockClear()
  })

  it('adds last_user_message_at before creating its index on legacy databases', async () => {
    const { getDb } = await import('./database')
    getDb()

    const execSql = dbMock.exec.mock.calls.map((call) => call[0] as string)
    const alterIndex = execSql.findIndex((sql) => sql.includes('ALTER TABLE sessions ADD COLUMN last_user_message_at TEXT'))
    const createIndex = execSql.findIndex((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_sessions_project_last_user ON sessions(project_id, last_user_message_at DESC)'))

    expect(alterIndex).toBeGreaterThan(-1)
    expect(createIndex).toBeGreaterThan(-1)
    expect(createIndex).toBeGreaterThan(alterIndex)
  })

  it('creates session_providers table with expected columns', async () => {
    const { getDb } = await import('./database')
    getDb()

    const execSql = dbMock.exec.mock.calls.map((call) => call[0] as string)
    const create = execSql.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS session_providers'))
    expect(create).toBeDefined()
    const normalized = (create as string).replace(/\s+/g, ' ')
    expect(normalized).toContain('id TEXT PRIMARY KEY')
    expect(normalized).toContain('harness_id TEXT NOT NULL')
    expect(normalized).toContain('name TEXT NOT NULL')
    expect(normalized).toContain('is_base INTEGER NOT NULL')
    expect(normalized).toContain('config_json TEXT NOT NULL')
    expect(normalized).toContain('created_at TEXT NOT NULL')
    expect(normalized).toContain('updated_at TEXT NOT NULL')
  })

  it('seeds base providers (claude-base, codex-base, acp-base)', async () => {
    const { getDb } = await import('./database')
    getDb()

    const prepareCalls = dbMock.prepare.mock.calls.map((call) => call[0] as string)
    const seedStmt = prepareCalls.find((sql) =>
      sql.includes('INSERT OR IGNORE INTO session_providers') || sql.includes('INSERT INTO session_providers')
    )
    expect(seedStmt).toBeDefined()
  })

  it('adds provider_id and provider_session_id to sessions, plus new indexes', async () => {
    const { getDb } = await import('./database')
    getDb()

    const execSql = dbMock.exec.mock.calls.map((call) => call[0] as string)
    expect(execSql.some((sql) => sql.includes('ALTER TABLE sessions ADD COLUMN provider_id'))).toBe(true)
    expect(execSql.some((sql) => sql.includes('ALTER TABLE sessions ADD COLUMN provider_session_id'))).toBe(true)
    expect(execSql.some((sql) => sql.includes('idx_sessions_provider'))).toBe(true)
    expect(execSql.some((sql) => sql.includes('idx_sessions_provider_session_id'))).toBe(true)
  })

  it('adds session_id to chat_messages with new indexes', async () => {
    const { getDb } = await import('./database')
    getDb()

    const execSql = dbMock.exec.mock.calls.map((call) => call[0] as string)
    expect(execSql.some((sql) => sql.includes('ALTER TABLE chat_messages ADD COLUMN session_id'))).toBe(true)
    expect(execSql.some((sql) => sql.includes('idx_chat_messages_session_v2'))).toBe(true)
    expect(execSql.some((sql) => sql.includes('idx_chat_messages_last_user_v2'))).toBe(true)
  })

  it('backfills provider_id based on legacy provider column', async () => {
    const { getDb } = await import('./database')
    getDb()

    const execSql = dbMock.exec.mock.calls.map((call) => call[0] as string)
    const backfill = execSql.find((sql) => sql.includes('UPDATE sessions') && sql.includes('provider_id') && sql.includes('WHERE provider_id IS NULL'))
    expect(backfill).toBeDefined()
    expect(backfill).toMatch(/codex-base/)
    expect(backfill).toMatch(/claude-base/)
  })

  it('backfills provider_session_id, mapping codex_local_ prefix to NULL', async () => {
    const { getDb } = await import('./database')
    getDb()

    const execSql = dbMock.exec.mock.calls.map((call) => call[0] as string)
    const backfill = execSql.find((sql) => sql.includes('UPDATE sessions') && sql.includes('provider_session_id'))
    expect(backfill).toBeDefined()
    expect(backfill).toMatch(/codex_local_%/)
  })

  it('backfills chat_messages.session_id by joining sessions on claude_session_id', async () => {
    const { getDb } = await import('./database')
    getDb()

    const execSql = dbMock.exec.mock.calls.map((call) => call[0] as string)
    const backfill = execSql.find((sql) => sql.includes('UPDATE chat_messages') && sql.includes('session_id'))
    expect(backfill).toBeDefined()
    expect(backfill).toMatch(/SELECT s\.id FROM sessions/)
  })

  it('rebuilds chat_messages and sessions tables without claude_session_id', async () => {
    const { getDb } = await import('./database')
    getDb()

    const execSql = dbMock.exec.mock.calls.map((call) => call[0] as string)
    expect(execSql.some((sql) => sql.includes('CREATE TABLE chat_messages_new'))).toBe(true)
    expect(execSql.some((sql) => sql.includes('ALTER TABLE chat_messages_new RENAME TO chat_messages'))).toBe(true)
    expect(execSql.some((sql) => sql.includes('CREATE TABLE sessions_new'))).toBe(true)
    expect(execSql.some((sql) => sql.includes('ALTER TABLE sessions_new RENAME TO sessions'))).toBe(true)

    const backfillIdx = execSql.findIndex((sql) => sql.includes('UPDATE chat_messages') && sql.includes('session_id'))
    const rebuildIdx = execSql.findIndex((sql) => sql.includes('CREATE TABLE chat_messages_new'))
    expect(rebuildIdx).toBeGreaterThan(backfillIdx)

    const newSchema = execSql.find((sql) => sql.includes('CREATE TABLE chat_messages_new')) as string
    expect(newSchema).not.toMatch(/claude_session_id/)
    const newSessionSchema = execSql.find((sql) => sql.includes('CREATE TABLE sessions_new')) as string
    expect(newSessionSchema).not.toMatch(/claude_session_id/)
  })

  it('migrates a legacy resource cache that predates the codex_models_json column without reading it', async () => {
    dbMock.prepare.mockImplementation((sql: string) => {
      if (sql === "SELECT name FROM sqlite_master WHERE type='table' AND name='global_resource_cache'") {
        return { get: () => ({ name: 'global_resource_cache' }) }
      }
      if (sql === 'PRAGMA table_info(global_resource_cache)') {
        return {
          all: () => [
            { name: 'id' },
            { name: 'models_json' },
            { name: 'account_json' },
            { name: 'slash_commands_json' },
            { name: 'updated_at' },
          ],
        }
      }
      if (sql.includes('FROM global_resource_cache') && sql.startsWith('SELECT models_json')) {
        return {
          get: () => ({ models_json: '[]', codex_models_json: '[]', account_json: '{}', slash_commands_json: '[]' }),
        }
      }
      return { all: () => [], get: () => undefined, run: vi.fn() }
    })

    const { getDb } = await import('./database')
    expect(() => getDb()).not.toThrow()

    const prepareSql = dbMock.prepare.mock.calls.map((call) => call[0] as string)
    const cacheSelect = prepareSql.find((sql) => sql.includes('FROM global_resource_cache') && sql.startsWith('SELECT models_json'))
    expect(cacheSelect).toBeDefined()
    expect(cacheSelect).not.toMatch(/models_json,\s*codex_models_json/)
    expect(cacheSelect).toMatch(/'\[\]' AS codex_models_json/)
  })

  it('reads codex_models_json directly when the legacy cache table has the column', async () => {
    dbMock.prepare.mockImplementation((sql: string) => {
      if (sql === "SELECT name FROM sqlite_master WHERE type='table' AND name='global_resource_cache'") {
        return { get: () => ({ name: 'global_resource_cache' }) }
      }
      if (sql === 'PRAGMA table_info(global_resource_cache)') {
        return {
          all: () => [
            { name: 'id' },
            { name: 'models_json' },
            { name: 'codex_models_json' },
            { name: 'account_json' },
            { name: 'slash_commands_json' },
            { name: 'updated_at' },
          ],
        }
      }
      if (sql.includes('FROM global_resource_cache') && sql.startsWith('SELECT models_json')) {
        return {
          get: () => ({ models_json: '[]', codex_models_json: '[]', account_json: '{}', slash_commands_json: '[]' }),
        }
      }
      return { all: () => [], get: () => undefined, run: vi.fn() }
    })

    const { getDb } = await import('./database')
    getDb()

    const prepareSql = dbMock.prepare.mock.calls.map((call) => call[0] as string)
    const cacheSelect = prepareSql.find((sql) => sql.includes('FROM global_resource_cache') && sql.startsWith('SELECT models_json'))
    expect(cacheSelect).toMatch(/models_json,\s*codex_models_json/)
  })

  it('is idempotent when re-run against an already-migrated database (no claude_session_id column)', async () => {
    dbMock.prepare.mockImplementation((sql: string) => {
      if (sql === 'PRAGMA table_info(sessions)') {
        return {
          all: () => [
            { name: 'id' },
            { name: 'project_id' },
            { name: 'title' },
            { name: 'created_at' },
            { name: 'total_cost_usd' },
            { name: 'context_tokens' },
            { name: 'provider' },
            { name: 'is_pinned' },
            { name: 'is_hidden' },
            { name: 'last_user_message_at' },
            { name: 'provider_id' },
            { name: 'provider_session_id' },
          ],
        }
      }
      if (sql === 'PRAGMA table_info(chat_messages)') {
        return {
          all: () => [
            { name: 'id' },
            { name: 'session_id' },
            { name: 'sort_order' },
            { name: 'role' },
            { name: 'status' },
            { name: 'content_json' },
            { name: 'created_at' },
            { name: 'provider_id' },
            { name: 'metadata_json' },
            { name: 'checkpoint_id' },
            { name: 'resume_point_id' },
          ],
        }
      }
      if (sql === 'PRAGMA table_info(api_providers)') return { all: () => [] }
      if (sql === 'PRAGMA table_info(global_resource_cache)') return { all: () => [] }
      if (sql === 'SELECT * FROM api_providers WHERE agent_configs = \'{}\'') return { all: () => [] }
      return { all: () => [], get: () => undefined, run: vi.fn() }
    })

    const { getDb } = await import('./database')
    expect(() => getDb()).not.toThrow()

    const execSql = dbMock.exec.mock.calls.map((call) => call[0] as string)
    expect(execSql.some((sql) => /^\s*UPDATE\s+sessions\b[\s\S]*claude_session_id/i.test(sql))).toBe(false)
    expect(execSql.some((sql) => /^\s*UPDATE\s+chat_messages\b[\s\S]*claude_session_id/i.test(sql))).toBe(false)
    expect(execSql.some((sql) => sql.includes('CREATE TABLE chat_messages_new'))).toBe(false)
    expect(execSql.some((sql) => sql.includes('CREATE TABLE sessions_new'))).toBe(false)
  })
})
