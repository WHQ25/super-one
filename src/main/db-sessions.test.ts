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

import { deleteSessionsOlderThan, listPinnedSessions, listSessionsForFolder } from './db-sessions'

describe('db-sessions provider inference query + mapping', () => {
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
        claude_session_id: 'codex_local_abcd',
        title: 'local codex',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        is_worktree: 0,
        is_pinned: 0,
        provider: 'codex' as const,
      },
      {
        id: 's2',
        claude_session_id: 'session-claude',
        title: 'claude session',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        is_worktree: 0,
        is_pinned: 1,
        provider: 'claude' as const,
      },
    ]
    const allMock = vi.fn().mockReturnValue(rows)
    const prepareMock = vi.fn((sql: string) => {
      expect(sql).toContain("codex_local_%")
      expect(sql).toContain("m2.provider_id = 'codex'")
      return { all: allMock }
    })
    getDbMock.mockReturnValue({ prepare: prepareMock })

    const sessions = listSessionsForFolder('/tmp/project-1')
    const providerBySessionId = Object.fromEntries(sessions.map((entry) => [entry.sessionId, entry.provider]))

    expect(allMock).toHaveBeenCalledWith('proj-1')
    expect(providerBySessionId['codex_local_abcd']).toBe('codex')
    expect(providerBySessionId['session-claude']).toBe('claude')
  })

  it('listPinnedSessions keeps inferred provider from SQL rows', () => {
    const rows = [
      {
        id: 'p1',
        claude_session_id: 'thread-1',
        title: 'codex pinned',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        is_worktree: 0,
        folder_path: '/tmp/project-1',
        folder_name: 'project-1',
        provider: 'codex' as const,
      },
      {
        id: 'p2',
        claude_session_id: 'thread-2',
        title: 'claude pinned',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        is_worktree: 1,
        folder_path: '/tmp/project-2',
        folder_name: 'project-2',
        provider: 'claude' as const,
      },
    ]
    const allMock = vi.fn().mockReturnValue(rows)
    const prepareMock = vi.fn((sql: string) => {
      expect(sql).toContain("codex_local_%")
      expect(sql).toContain("m2.provider_id = 'codex'")
      return { all: allMock }
    })
    getDbMock.mockReturnValue({ prepare: prepareMock })

    const sessions = listPinnedSessions()
    const providerBySessionId = Object.fromEntries(sessions.map((entry) => [entry.sessionId, entry.provider]))

    expect(providerBySessionId['thread-1']).toBe('codex')
    expect(providerBySessionId['thread-2']).toBe('claude')
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
      { claude_session_id: 'old-session-1' },
      { claude_session_id: 'old-session-2' },
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
