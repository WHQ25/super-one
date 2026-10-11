import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'

const { getDbMock, getProjectIdMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getProjectIdMock: vi.fn(),
}))

vi.mock('../database', () => ({ getDb: getDbMock }))
vi.mock('../recent-folders', () => ({ getProjectId: getProjectIdMock }))
vi.mock('../logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../usage-stats-service', () => ({
  recordSessionStarted: vi.fn(),
  recordMessageCounts: vi.fn(),
}))

import { forkSessionRecord, insertSessionRecord, saveSessionStateBySid } from './session-repo'
import { watchSessionList } from '../session-list-watch'
import { bindSessionListNotifications } from '../session-list-notifications'

/**
 * Only two reads decide anything here: whether the session already had a row,
 * and (for a fork) which project the source lives in. Every other statement is
 * a write whose result the code under test never looks at.
 */
type StoredRow = { provider_id: string | null; git_branch: string | null; worktree_path?: string | null; acp_agent_id?: string | null }

function fakeDb(options: { sessionExists?: boolean; storedRow?: StoredRow; sourceProjectPath?: string } = {}) {
  return {
    prepare: (rawSql: string) => {
      const sql = rawSql.replace(/\s+/g, ' ').trim()
      return {
        get: () => {
          if (sql.includes('AS project_path')) {
            return {
              id: 'source-1',
              project_id: 'project-1',
              project_path: options.sourceProjectPath ?? '/repo',
              provider_id: 'claude-base',
              provider: 'claude',
              provider_session_id: null,
              title: 'Source',
              created_at: '2026-01-01T00:00:00.000Z',
              last_user_message_at: '2026-01-01T00:00:00.000Z',
            }
          }
          if (sql.includes('SELECT created_at, usage_counted_at, provider_id')) {
            if (!options.sessionExists && !options.storedRow) return undefined
            const row = options.storedRow ?? { provider_id: 'claude-base', git_branch: null }
            return {
              created_at: '2026-01-01T00:00:00.000Z',
              usage_counted_at: '2026-01-01T00:00:00.000Z',
              worktree_path: null,
              acp_agent_id: null,
              ...row,
            }
          }
          return undefined
        },
        all: () => [],
        run: () => ({ changes: 1 }),
      }
    },
    transaction: (fn: () => void) => () => { fn() },
  }
}

function userMessage(): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text: 'hi' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'claude-base',
  }
}

function persist(): void {
  saveSessionStateBySid({
    sid: 'session-1',
    projectPath: '/repo',
    providerId: 'claude-base',
    messages: [userMessage()],
    totalCostUsd: 0,
    contextTokens: 0,
    isWorktree: false,
  })
}

describe('session list watchers on the session-repo writes', () => {
  const changed: string[] = []
  let unwatch = () => {}

  beforeEach(() => {
    changed.length = 0
    getDbMock.mockReset()
    getProjectIdMock.mockReset()
    getProjectIdMock.mockReturnValue('project-1')
    getDbMock.mockReturnValue(fakeDb())
    unwatch = watchSessionList((projectPath) => { changed.push(projectPath) })
  })
  afterEach(() => { unwatch() })

  it('reports the project when the first persist creates the session row', () => {
    persist()
    expect(changed).toEqual(['/repo'])
  })

  // Every state change of a streaming turn reaches this write, and a client
  // answers the signal by re-reading the whole list.
  it('stays quiet on later persists of a session that already exists', () => {
    getDbMock.mockReturnValue(fakeDb({ sessionExists: true }))
    persist()
    expect(changed).toEqual([])
  })

  // A phone/node create inserts the row before the runtime exists, so it holds
  // the column defaults until the first persist names the harness and branch.
  it('reports a pre-inserted row once its first persist fills in harness and branch', () => {
    getDbMock.mockReturnValue(fakeDb({ storedRow: { provider_id: null, git_branch: null } }))
    saveSessionStateBySid({
      sid: 'session-1', projectPath: '/repo', providerId: 'codex-base', gitBranch: 'main',
      messages: [userMessage()], totalCostUsd: 0, contextTokens: 0,
    })
    expect(changed).toEqual(['/repo'])
  })

  it('reports a branch change on an existing session', () => {
    getDbMock.mockReturnValue(fakeDb({ storedRow: { provider_id: 'claude-base', git_branch: 'main' } }))
    saveSessionStateBySid({
      sid: 'session-1', projectPath: '/repo', providerId: 'claude-base', gitBranch: 'feature',
      messages: [userMessage()], totalCostUsd: 0, contextTokens: 0,
    })
    expect(changed).toEqual(['/repo'])
  })

  it('invalidates desktop and phone lists when a voice-only session first becomes durable', () => {
    const desktopChanged = vi.fn()
    const remoteEvents: AgentEvent[] = []
    const unbind = bindSessionListNotifications(desktopChanged, event => remoteEvents.push(event))
    const voice = {
      sid: 'voice-session', projectPath: '/repo', providerId: 'codex-base',
      providerSessionId: 'thread-voice', messages: [], totalCostUsd: 0, contextTokens: 0,
    }
    try {
      saveSessionStateBySid(voice)
      expect(desktopChanged).toHaveBeenCalledTimes(1)
      expect(desktopChanged).toHaveBeenCalledWith('/repo')
      expect(remoteEvents).toEqual([{ type: 'session_list_changed', projectPath: '/repo' }])
      getDbMock.mockReturnValue(fakeDb({ storedRow: { provider_id: 'codex-base', git_branch: null } }))
      saveSessionStateBySid(voice)
      expect(desktopChanged).toHaveBeenCalledTimes(1)
      expect(remoteEvents).toHaveLength(1)
    } finally { unbind() }
  })

  it('reports a session inserted ahead of its first message', () => {
    insertSessionRecord({ id: 'session-2', projectPath: '/repo', providerId: 'claude-base' })
    expect(changed).toEqual(['/repo'])
  })

  it('says nothing about a hidden session, which no list shows', () => {
    insertSessionRecord({ id: 'session-3', projectPath: '/repo', providerId: 'claude-base', isHidden: true })
    expect(changed).toEqual([])
  })

  it('reports the source project when a session is forked', () => {
    getDbMock.mockReturnValue(fakeDb({ sourceProjectPath: '/other-repo' }))
    forkSessionRecord({
      sourceId: 'source-1',
      newId: 'fork-1',
      providerSessionId: 'provider-1',
      worktreePath: null,
      gitBranch: null,
      title: 'Fork',
    })
    expect(changed).toEqual(['/other-repo'])
  })
})
