import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as Database.Database | null }))
vi.mock('./database', () => ({ getDb: () => db.current }))

import {
  getRemoteControlledSession,
  listRemoteControlledSessions,
  remoteControllerInfo,
  setSessionRemoteController,
} from './db-remote-controlled-sessions'

beforeEach(() => {
  db.current = new Database(':memory:')
  db.current.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT UNIQUE, name TEXT, added_at TEXT);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_id TEXT, title TEXT, created_at TEXT, last_user_message_at TEXT,
      provider TEXT, provider_id TEXT, provider_session_id TEXT, worktree_path TEXT,
      is_pinned INTEGER, is_hidden INTEGER, is_user_renamed INTEGER, tags_json TEXT NOT NULL DEFAULT '[]',
      remote_controller_json TEXT
    );
    INSERT INTO projects VALUES ('p1', '/work/app', 'app', '2026-01-01T00:00:00.000Z');
    INSERT INTO sessions (id, project_id, title, created_at) VALUES ('local', 'p1', 'mine', '2026-01-01T00:00:00.000Z');
    INSERT INTO sessions (id, project_id, title, created_at) VALUES ('remote', 'p1', 'child', '2026-01-02T00:00:00.000Z');
  `)
})

describe('remote-controlled sessions', () => {
  it('marks a session with its controller and lists only marked sessions', () => {
    expect(setSessionRemoteController('remote', { clientSessionId: 'c1', label: 'Desktop A', permissionMode: 'acceptEdits' }, 'codex-base')).toBe(true)

    expect(listRemoteControlledSessions('p1').map((r) => r.sessionId)).toEqual(['remote'])
    expect(listRemoteControlledSessions('other')).toEqual([])
    expect(getRemoteControlledSession('local')).toBeNull()
    expect(getRemoteControlledSession('remote')).toMatchObject({
      projectPath: '/work/app',
      harnessId: 'codex',
      providerId: 'codex-base',
      controller: { clientSessionId: 'c1', label: 'Desktop A', permissionMode: 'acceptEdits' },
    })
  })

  it('exposes only the label to the renderer and ignores unreadable markers', () => {
    expect(remoteControllerInfo(JSON.stringify({ clientSessionId: 'c1', label: 'Desktop A', systemPromptAppend: 'x' }))).toEqual({ label: 'Desktop A' })
    expect(remoteControllerInfo('{')).toBeNull()
    expect(remoteControllerInfo(JSON.stringify({ label: 'no id' }))).toBeNull()
    expect(remoteControllerInfo(null)).toBeNull()
  })
})
