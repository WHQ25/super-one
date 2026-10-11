import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('./database', () => ({ getDb: () => state.db }))
vi.mock('./recent-folders', () => ({ getProjectId: () => 'project' }))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

import { createSession } from './db-sessions'

beforeEach(() => {
  state.db = new Database(':memory:')
  state.db.exec(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY, project_id TEXT, title TEXT, created_at TEXT,
    last_user_message_at TEXT, is_worktree INTEGER, git_branch TEXT,
    worktree_path TEXT, provider_id TEXT, provider TEXT, provider_session_id TEXT
  )`)
})
afterEach(() => state.db?.close())

it('records the requested provider before the first turn and clears an old thread on harness replacement', () => {
  const db = state.db!
  createSession('/project', 'new', undefined, undefined, undefined, undefined, 'codex-base')
  expect(db.prepare('SELECT provider_id, provider FROM sessions WHERE id = ?').get('new'))
    .toEqual({ provider_id: 'codex-base', provider: 'codex' })

  db.prepare('UPDATE sessions SET provider_session_id = ? WHERE id = ?').run('old-thread', 'new')
  createSession('/project', 'new')
  expect(db.prepare('SELECT provider_id, provider_session_id FROM sessions WHERE id = ?').get('new'))
    .toEqual({ provider_id: 'codex-base', provider_session_id: 'old-thread' })

  createSession('/project', 'new', undefined, undefined, undefined, undefined, 'claude-base')
  expect(db.prepare('SELECT provider_id, provider_session_id FROM sessions WHERE id = ?').get('new'))
    .toEqual({ provider_id: 'claude-base', provider_session_id: null })
})
