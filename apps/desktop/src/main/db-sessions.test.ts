import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, getProjectIdMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getProjectIdMock: vi.fn(),
}))

vi.mock('./database', () => ({
  getDb: getDbMock,
}))

vi.mock('./recent-folders', () => ({
  getProjectId: getProjectIdMock,
}))

vi.mock('./logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { deleteSessionsOlderThan, listPinnedSessions, listSessionsForFolder, saveSessionState } from './db-sessions'

describe('db-sessions session query + mapping', () => {
  beforeEach(() => {
    getDbMock.mockReset()
    getProjectIdMock.mockReset()
  })

  it('returns empty list when project is unknown', () => {
    getProjectIdMock.mockReturnValue(null)
    const prepareMock = vi.fn()
    getDbMock.mockReturnValue({ prepare: prepareMock })

    const sessions = listSessionsForFolder('/tmp/missing')

    expect(sessions).toEqual([])
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('listSessionsForFolder keeps inferred provider from SQL rows', () => {
    getProjectIdMock.mockReturnValue('proj-1')
    const rows = [
      {
        id: 's1',
        title: 'local codex',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        is_worktree: 0,
        is_pinned: 0,
        provider_id: 'codex-base',
        provider: 'codex',
      },
      {
        id: 's2',
        title: 'claude session',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        is_worktree: 0,
        is_pinned: 1,
        provider_id: 'claude-base',
        provider: 'claude',
      },
      {
        id: 's3',
        title: 'acp session with stale legacy column',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        is_worktree: 0,
        is_pinned: 0,
        provider_id: 'acp-base',
        provider: 'claude',
      },
    ]
    const allMock = vi.fn().mockReturnValue(rows)
    const prepareMock = vi.fn((sql: string) => {
      expect(sql).toContain('last_user_message_at')
      expect(sql).toContain('provider_id')
      expect(sql).not.toContain("m2.provider_id = 'codex'")
      return { all: allMock }
    })
    getDbMock.mockReturnValue({ prepare: prepareMock })

    const sessions = listSessionsForFolder('/tmp/project-1')
    const providerBySessionId = Object.fromEntries(sessions.map((entry) => [entry.sessionId, entry.provider]))

    expect(allMock).toHaveBeenCalledWith('proj-1')
    expect(providerBySessionId['s1']).toBe('codex')
    expect(providerBySessionId['s2']).toBe('claude')
    expect(providerBySessionId['s3']).toBe('acp')
  })

  it('listPinnedSessions keeps inferred provider from SQL rows', () => {
    const rows = [
      {
        id: 'p1',
        title: 'codex pinned',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        is_worktree: 0,
        folder_path: '/tmp/project-1',
        folder_name: 'project-1',
        provider_id: 'codex-base',
        provider: 'codex',
      },
      {
        id: 'p2',
        title: 'claude pinned',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        is_worktree: 1,
        folder_path: '/tmp/project-2',
        folder_name: 'project-2',
        provider_id: 'claude-base',
        provider: 'claude',
      },
      {
        id: 'p3',
        title: 'acp pinned',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        is_worktree: 0,
        folder_path: '/tmp/project-3',
        folder_name: 'project-3',
        provider_id: 'acp-base',
        provider: 'claude',
      },
    ]
    const allMock = vi.fn().mockReturnValue(rows)
    const prepareMock = vi.fn((sql: string) => {
      expect(sql).toContain('last_user_message_at')
      expect(sql).toContain('provider_id')
      expect(sql).not.toContain("m2.provider_id = 'codex'")
      return { all: allMock }
    })
    getDbMock.mockReturnValue({ prepare: prepareMock })

    const sessions = listPinnedSessions()
    const providerBySessionId = Object.fromEntries(sessions.map((entry) => [entry.sessionId, entry.provider]))

    expect(providerBySessionId['p1']).toBe('codex')
    expect(providerBySessionId['p2']).toBe('claude')
    expect(providerBySessionId['p3']).toBe('acp')
  })
})

describe('deleteSessionsOlderThan', () => {
  beforeEach(() => {
    getDbMock.mockReset()
    getProjectIdMock.mockReset()
  })

  it('returns empty array when project is unknown', () => {
    getProjectIdMock.mockReturnValue(null)
    const result = deleteSessionsOlderThan('/tmp/missing', '2026-01-01T00:00:00.000Z')
    expect(result).toEqual([])
  })

  it('returns empty array when no sessions match', () => {
    getProjectIdMock.mockReturnValue('proj-1')
    const allMock = vi.fn().mockReturnValue([])
    const prepareMock = vi.fn().mockReturnValue({ all: allMock })
    getDbMock.mockReturnValue({ prepare: prepareMock })

    const result = deleteSessionsOlderThan('/tmp/project', '2026-01-01T00:00:00.000Z')
    expect(result).toEqual([])
    expect(prepareMock).toHaveBeenCalledTimes(1)
  })

  it('deletes matching sessions and returns their IDs', () => {
    getProjectIdMock.mockReturnValue('proj-1')
    const matchingRows = [
      { id: 'old-session-1' },
      { id: 'old-session-2' },
    ]
    const allMock = vi.fn().mockReturnValue(matchingRows)
    const runMock = vi.fn()
    const prepareMock = vi.fn().mockReturnValue({ all: allMock, run: runMock })
    getDbMock.mockReturnValue({ prepare: prepareMock })

    const result = deleteSessionsOlderThan('/tmp/project', '2026-02-01T00:00:00.000Z')

    expect(result).toEqual(['old-session-1', 'old-session-2'])
    expect(prepareMock).toHaveBeenCalledTimes(2)
    expect(runMock).toHaveBeenCalledWith('old-session-1', 'old-session-2')
  })

  it('excludes pinned sessions in SQL query', () => {
    getProjectIdMock.mockReturnValue('proj-1')
    const allMock = vi.fn().mockReturnValue([])
    const prepareMock = vi.fn((sql: string) => {
      if (sql.includes('SELECT')) {
        expect(sql).toContain('is_pinned')
      }
      return { all: allMock, run: vi.fn() }
    })
    getDbMock.mockReturnValue({ prepare: prepareMock })

    deleteSessionsOlderThan('/tmp/project', '2026-01-01T00:00:00.000Z')
    expect(allMock).toHaveBeenCalledWith('proj-1', '2026-01-01T00:00:00.000Z')
  })
})

describe('saveSessionState', () => {
  beforeEach(() => {
    getDbMock.mockReset()
  })

  function makeSaveSessionMock() {
    const upsertMsgRun = vi.fn()
    const updateSessionRun = vi.fn()
    const deleteRun = vi.fn()
    const updateUsageCountedRun = vi.fn()
    const activityRun = vi.fn()
    const sessionGet = vi.fn().mockReturnValue({ created_at: '2026-01-01T00:00:00.000Z', usage_counted_at: null })
    const priorCountedAll = vi.fn().mockReturnValue([])

    const prepareMock = vi.fn((sql: string) => {
      const trimmed = sql.replace(/\s+/g, ' ').trim()
      if (trimmed.startsWith('INSERT INTO chat_messages')) return { run: upsertMsgRun }
      if (trimmed.startsWith('UPDATE sessions') && trimmed.includes('total_cost_usd')) return { run: updateSessionRun }
      if (trimmed.startsWith('SELECT created_at, usage_counted_at FROM sessions')) return { get: sessionGet }
      if (trimmed.startsWith('SELECT id FROM chat_messages')) return { all: priorCountedAll }
      if (trimmed.startsWith('DELETE FROM chat_messages')) return { run: deleteRun }
      if (trimmed.startsWith('UPDATE sessions SET usage_counted_at')) return { run: updateUsageCountedRun }
      if (trimmed.startsWith('INSERT INTO activity_daily')) return { run: activityRun }
      return { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) }
    })
    const transactionMock = vi.fn((fn: () => void) => fn)
    getDbMock.mockReturnValue({ prepare: prepareMock, transaction: transactionMock })
    return { upsertMsgRun, updateSessionRun }
  }

  it('converts streaming status to interrupted on write', () => {
    const { upsertMsgRun } = makeSaveSessionMock()

    saveSessionState('session-1', {
      messages: [
        { id: 'msg-1', role: 'assistant', status: 'streaming', content: [], createdAt: '2026-01-01T00:00:00.000Z', providerId: 'claude' },
        { id: 'msg-2', role: 'user', status: 'complete', content: [], createdAt: '2026-01-01T00:00:00.000Z', providerId: 'claude' },
      ] as never[],
      totalCostUsd: 0,
      contextTokens: 0,
    })

    const calls = upsertMsgRun.mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][3]).toBe('assistant')
    expect(calls[0][4]).toBe('interrupted')
    expect(calls[1][3]).toBe('user')
    expect(calls[1][4]).toBe('complete')
  })

  it('stores latest user message timestamp on session update', () => {
    const { updateSessionRun } = makeSaveSessionMock()

    saveSessionState('session-1', {
      messages: [
        { id: 'msg-1', role: 'user', status: 'complete', content: [], createdAt: '2026-01-01T00:00:00.000Z', providerId: 'claude' },
        { id: 'msg-2', role: 'assistant', status: 'complete', content: [], createdAt: '2026-01-01T00:01:00.000Z', providerId: 'claude' },
        { id: 'msg-3', role: 'user', status: 'complete', content: [], createdAt: '2026-01-01T00:02:00.000Z', providerId: 'claude' },
      ] as never[],
      totalCostUsd: 0,
      contextTokens: 0,
      provider: 'claude',
    })

    expect(updateSessionRun).toHaveBeenLastCalledWith(0, 0, 'claude', '2026-01-01T00:02:00.000Z', 'session-1')
  })
})
