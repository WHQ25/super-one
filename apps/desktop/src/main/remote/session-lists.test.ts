import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('../database', () => ({ getDb: getDbMock }))
vi.mock('../recent-folders', () => ({ getProjectId: () => 'project' }))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { deleteScheduledSend, deleteScheduledSendBySource, ensureScheduledSendsSchema, upsertScheduledSend } from '../db-scheduled-sends'
import { watchSessionList } from '../session-list-watch'
import { readRemoteSessionList } from './session-lists'
import type { Session } from '../session/types'

let db: Database.Database
let unwatch = () => {}
const changed: string[] = []
const sendAt = Date.UTC(2026, 8, 15, 10)
const projectList = () => readRemoteSessionList({ kind: 'page', projectPath: '/repo' })

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT, name TEXT);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_id TEXT, title TEXT, created_at TEXT,
      last_user_message_at TEXT, is_worktree INTEGER, is_pinned INTEGER,
      is_hidden INTEGER, git_branch TEXT, worktree_path TEXT, is_automation INTEGER,
      automation_id TEXT, provider_session_id TEXT, provider_id TEXT, provider TEXT,
      acp_agent_id TEXT, selected_model TEXT, tags_json TEXT, remote_controller_json TEXT
    );
    CREATE TABLE session_collaboration_grants (child_session_id TEXT, parent_session_id TEXT, kind TEXT, config_json TEXT);
    CREATE TABLE chat_messages (session_id TEXT);
    INSERT INTO projects VALUES ('project', '/repo', 'repo');
    INSERT INTO sessions (id, project_id, title, created_at, is_pinned, provider_id)
      VALUES ('one', 'project', 'Review changes', '2026-09-14', 1, 'codex-base'),
             ('two', 'project', 'Other session', '2026-09-13', 0, 'claude-base');
  `)
  ensureScheduledSendsSchema(db)
  getDbMock.mockReturnValue(db)
  changed.length = 0
  unwatch = watchSessionList(path => changed.push(path))
})

afterEach(() => { unwatch(); db.close() })

describe('mobile session list scheduled sends', () => {
  it('reads the live model and activity rather than the stale stored defaults', () => {
    db.prepare('UPDATE sessions SET selected_model = ? WHERE id = ?').run('old-model', 'one')
    const live = { snapshot: { selectedModel: 'live-model' }, activityStatus: () => 'streaming' } as unknown as Session
    const page = readRemoteSessionList({ kind: 'page', projectPath: '/repo' }, { getSession: id => id === 'one' ? live : null })
    expect(page.sessions).toContainEqual(expect.objectContaining({ sessionId: 'one', selectedModel: 'live-model', status: 'streaming' }))
    expect(page.sessions).toContainEqual(expect.objectContaining({ sessionId: 'two', status: 'idle' }))
  })
  it.each([-1, 0, 201, 1.5, NaN, Infinity])('rejects the unbounded page limit %s', limit => {
    expect(() => readRemoteSessionList({ kind: 'page', projectPath: '/repo', limit })).toThrow('limit must be')
  })
  it('refreshes the sidebar when a send is armed, retimed, disarmed and delivered', () => {
    upsertScheduledSend('one', { sendAt, armed: false, source: 'rate_limit' })
    expect(projectList().sessions[0].scheduledSendAt).toBeNull()
    expect(changed).toEqual([])

    upsertScheduledSend('one', { armed: true })
    expect(changed).toEqual(['/repo'])
    expect(projectList().sessions[0].scheduledSendAt).toBe(sendAt)

    upsertScheduledSend('one', { message: 'Private draft text' })
    expect(changed).toHaveLength(1)
    expect(JSON.stringify(projectList())).not.toContain('Private draft text')

    upsertScheduledSend('one', { sendAt: sendAt + 60_000 })
    expect(projectList().sessions[0].scheduledSendAt).toBe(sendAt + 60_000)
    upsertScheduledSend('one', { armed: false })
    expect(projectList().sessions[0].scheduledSendAt).toBeNull()
    upsertScheduledSend('one', { armed: true })
    deleteScheduledSend('one')
    expect(projectList().sessions[0].scheduledSendAt).toBeNull()
    expect(changed).toHaveLength(5)
  })

  it('includes the same armed state in pinned and search results after reconnect', () => {
    upsertScheduledSend('one', { sendAt, armed: true })
    for (const command of [
      { kind: 'pinned' } as const,
      { kind: 'search', query: 'review' } as const,
    ]) {
      expect(readRemoteSessionList(command).sessions).toEqual([
        expect.objectContaining({ sessionId: 'one', scheduledSendAt: sendAt, projectPath: '/repo' }),
      ])
    }
    expect(readRemoteSessionList({ kind: 'page', projectPath: '/repo', limit: 1, offset: 1 }))
      .toMatchObject({ totalCount: 2, sessions: [{ sessionId: 'two', scheduledSendAt: null }] })
  })

  it('pages an armed send in first, ahead of more recent sessions', () => {
    upsertScheduledSend('two', { sendAt, armed: true })
    expect(readRemoteSessionList({ kind: 'page', projectPath: '/repo', limit: 1 }))
      .toMatchObject({ totalCount: 2, sessions: [{ sessionId: 'two', scheduledSendAt: sendAt }] })
    expect(readRemoteSessionList({ kind: 'page', projectPath: '/repo', limit: 1, offset: 1 }).sessions)
      .toEqual([expect.objectContaining({ sessionId: 'one' })])
  })

  it('finds one session by id with its project, and nothing for a hidden or unknown id', () => {
    expect(readRemoteSessionList({ kind: 'find', sessionId: 'two' })).toEqual({
      session: expect.objectContaining({ sessionId: 'two', title: 'Other session', provider: 'claude', projectPath: '/repo', projectName: 'repo' }),
    })
    db.prepare('UPDATE sessions SET is_hidden = 1 WHERE id = ?').run('two')
    expect(readRemoteSessionList({ kind: 'find', sessionId: 'two' })).toEqual({ session: null })
    expect(readRemoteSessionList({ kind: 'find', sessionId: 'missing' })).toEqual({ session: null })
  })

  it('only invalidates a source-scoped deletion when it removes an armed send', () => {
    upsertScheduledSend('one', { sendAt, armed: true, source: 'manual' })
    changed.length = 0
    deleteScheduledSendBySource('one', 'rate_limit')
    expect(changed).toEqual([])
    expect(projectList().sessions[0].scheduledSendAt).toBe(sendAt)
    deleteScheduledSendBySource('one', 'manual')
    expect(changed).toEqual(['/repo'])
    expect(projectList().sessions[0].scheduledSendAt).toBeNull()
  })
})
