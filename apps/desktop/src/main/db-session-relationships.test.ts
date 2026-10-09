import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('./database', () => ({ getDb: getDbMock }))

import { loadSessionState } from './db-sessions'

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  getDbMock.mockReturnValue(db)
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, title TEXT, total_cost_usd REAL, context_tokens INTEGER,
      is_worktree INTEGER, git_branch TEXT, worktree_path TEXT, provider TEXT, provider_id TEXT,
      provider_session_id TEXT, api_provider_id TEXT, acp_agent_id TEXT,
      selected_model TEXT, selected_effort TEXT, codex_service_tier TEXT
    );
    CREATE TABLE session_collaboration_grants (parent_session_id TEXT, child_session_id TEXT, kind TEXT);
    CREATE TABLE chat_messages (
      id TEXT, session_id TEXT, sort_order INTEGER, role TEXT, status TEXT, content_json TEXT,
      created_at TEXT, provider_id TEXT, metadata_json TEXT, checkpoint_id TEXT, resume_point_id TEXT
    );
    INSERT INTO sessions (id, provider_id) VALUES ('parent', 'claude-base'), ('child', 'claude-base');
  `)
})
afterEach(() => { db.close() })

it.each(['spawn', null])('hydrates the spawn parent from the grant with kind=%s', (kind) => {
  db.prepare('INSERT INTO session_collaboration_grants VALUES (?, ?, ?)').run('parent', 'child', kind)
  expect(loadSessionState('child')?.parentSessionId).toBe('parent')
  expect(loadSessionState('parent')?.parentSessionId).toBeNull()
})

it.each(['link', 'handoff'])('keeps %s sessions independent even when task history names the sender', (kind) => {
  db.prepare('INSERT INTO session_collaboration_grants VALUES (?, ?, ?)').run('parent', 'child', kind)
  expect(loadSessionState('child')?.parentSessionId).toBeNull()
})
