import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'

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

/**
 * Only two reads decide anything here: whether the session already had a row,
 * and (for a fork) which project the source lives in. Every other statement is
 * a write whose result the code under test never looks at.
 */
function fakeDb(options: { sessionExists?: boolean; sourceProjectPath?: string } = {}) {
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
          if (sql.includes('created_at, usage_counted_at FROM sessions')) {
            return options.sessionExists
              ? { created_at: '2026-01-01T00:00:00.000Z', usage_counted_at: '2026-01-01T00:00:00.000Z' }
              : undefined
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
