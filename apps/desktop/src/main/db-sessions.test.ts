import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, getProjectIdMock, clearSpeechCacheMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getProjectIdMock: vi.fn(),
  clearSpeechCacheMock: vi.fn(async () => {}),
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

vi.mock('./speech/session-cache', () => ({
  clearSpeechCache: clearSpeechCacheMock,
}))

import { sessionTitleLikePatterns } from '@superone/shared/session-title-search'
import { countMessagesForSessions, deleteSession, deleteSessionsOlderThan, listPinnedSessions, listSessionsForFolder, listSessionsForProjectId, listSettledSessions, saveSessionState, searchSessionsByTitle, settleSession, settleSpawnChildren } from './db-sessions'
import { watchSessionDeletes } from './session-list-watch'

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
        selected_model: 'gpt-5.6',
        parent_session_id: 'parent-1',
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
    expect(providerBySessionId['s3']).toBe('acp-grok')
    expect(sessions[0].selectedModel).toBe('gpt-5.6')
    expect(sessions[0].parentSessionId).toBe('parent-1')
  })

  it('listSessionsForFolder maps tags_json onto the history entry', () => {
    getProjectIdMock.mockReturnValue('proj-1')
    const rows = [
      {
        id: 's1',
        title: 'tagged',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        tags_json: '["ui","sidebar"]',
      },
      {
        id: 's2',
        title: 'untagged',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        tags_json: '[]',
      },
    ]
    const allMock = vi.fn().mockReturnValue(rows)
    const prepareMock = vi.fn((sql: string) => {
      expect(sql).toContain('tags_json')
      return { all: allMock }
    })
    getDbMock.mockReturnValue({ prepare: prepareMock })

    const sessions = listSessionsForFolder('/tmp/project-1')
    expect(sessions[0].tags).toEqual(['ui', 'sidebar'])
    expect(sessions[1].tags).toBeUndefined()
  })

  it('keeps settled sessions out of the active list and returns them for search', () => {
    getProjectIdMock.mockReturnValue('proj-1')
    const sqls: string[] = []
    getDbMock.mockReturnValue({
      prepare: vi.fn((sql: string) => {
        sqls.push(sql)
        return { all: vi.fn().mockReturnValue([]) }
      }),
    })

    listSessionsForFolder('/tmp/project-1')
    expect(sqls[0]).toContain('COALESCE(s.is_settled, 0) = 0')

    listSessionsForProjectId('proj-1', 30, 0, { includeSettled: true })
    expect(sqls[1]).not.toContain('COALESCE(s.is_settled, 0) = 0')
  })

  it('pages root sessions and counts the children left off the page', () => {
    const sqls: string[] = []
    const params: unknown[][] = []
    getDbMock.mockReturnValue({
      prepare: vi.fn((sql: string) => {
        sqls.push(sql)
        return {
          all: (...args: unknown[]) => {
            params.push(args)
            return [{
              id: 'parent',
              title: 'Parent',
              created_at: '2026-01-01T00:00:00.000Z',
              last_user_msg_at: '2026-01-01T00:00:00.000Z',
              child_count: 4,
            }]
          },
        }
      }),
    })

    const sessions = listSessionsForProjectId('proj-1', 20, 0, { rootsOnly: true })
    expect(sqls[0]).toContain('WHERE parent_session_id IS NULL')
    expect(sqls[0]).toContain('AS child_count')
    expect(params[0]).toEqual(['proj-1', 20, 0])
    expect(sessions[0]).toMatchObject({ sessionId: 'parent', childCount: 4 })
    expect(sessions[0]?.parentSessionId).toBeUndefined()
  })

  it('pages the spawn children of one parent', () => {
    const sqls: string[] = []
    const params: unknown[][] = []
    getDbMock.mockReturnValue({
      prepare: vi.fn((sql: string) => {
        sqls.push(sql)
        return { all: (...args: unknown[]) => { params.push(args); return [] } }
      }),
    })

    listSessionsForProjectId('proj-1', 20, 20, { parentSessionId: 'parent' })
    expect(sqls[0]).toContain('COALESCE(g.parent_session_id,')
    expect(sqls[0]).toContain('COALESCE(s.is_hidden, 0) = 0')
    expect(sqls[0]).not.toContain('WHERE parent_session_id IS NULL')
    expect(params[0]).toEqual(['proj-1', 'parent', 20, 20])
  })

  it('pages settled sessions for one project', () => {
    const sqls: string[] = []
    const params: unknown[][] = []
    getDbMock.mockReturnValue({
      prepare: vi.fn((sql: string) => {
        sqls.push(sql)
        return {
          all: (...args: unknown[]) => {
            params.push(args)
            return []
          },
          get: (...args: unknown[]) => {
            params.push(args)
            return { total: 48 }
          },
        }
      }),
    })

    expect(listSettledSessions({ projectPath: '/tmp/project-1', limit: 20, offset: 40 })).toEqual({
      sessions: [],
      total: 48,
    })
    expect(sqls[0]).toContain('COALESCE(s.is_settled, 0) = 1')
    expect(sqls[0]).toContain('COALESCE(s.is_hidden, 0) = 0')
    expect(sqls[0]).toContain('p.path = ?')
    expect(sqls[0]).toContain('LIMIT ? OFFSET ?')
    expect(params[0]).toEqual(['/tmp/project-1', 20, 40])
    expect(sqls[1]).toContain('COUNT(*)')
    expect(sqls[1]).toContain('COALESCE(s.is_settled, 0) = 1')
    expect(sqls[1]).not.toContain('LIMIT')
    expect(params[1]).toEqual(['/tmp/project-1'])

    listSettledSessions()
    expect(sqls[2]).not.toContain('LIMIT')
    expect(sqls[3]).toContain('COUNT(*)')
    expect(params[3]).toEqual([])
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
    expect(providerBySessionId['p3']).toBe('acp-grok')
  })

  it('listPinnedSessions maps acpAgentId so grok keeps its brand icon', () => {
    const rows = [
      {
        id: 'p-grok',
        title: 'grok pinned',
        created_at: '2026-01-01T00:00:00.000Z',
        last_user_msg_at: '2026-01-01T00:00:00.000Z',
        is_worktree: 0,
        folder_path: '/tmp/project-1',
        folder_name: 'project-1',
        provider_id: 'acp-base',
        provider: 'acp',
        acp_agent_id: 'grok-build',
      },
    ]
    const allMock = vi.fn().mockReturnValue(rows)
    const prepareMock = vi.fn((sql: string) => {
      expect(sql).toContain('acp_agent_id')
      return { all: allMock }
    })
    getDbMock.mockReturnValue({ prepare: prepareMock })

    const sessions = listPinnedSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.provider).toBe('acp-grok')
    expect(sessions[0]?.acpAgentId).toBe('grok-build')
  })

  it('searchSessionsByTitle orders by match tier, and lists recent rows when empty', () => {
    const calls: { sql: string; args: unknown[] }[] = []
    getDbMock.mockReturnValue({
      prepare: (sql: string) => ({
        all: (...args: unknown[]) => {
          calls.push({ sql, args })
          return []
        },
      }),
    })

    const escaped = sessionTitleLikePatterns('a%b')
    searchSessionsByTitle('a%b', 10)
    expect(calls[0]?.sql).toContain('ORDER BY CASE')
    expect(calls[0]?.sql).toContain('last_user_msg_at DESC')
    expect(calls[0]?.args).toEqual([
      escaped.subsequence,
      escaped.prefix,
      ...escaped.wordPrefix,
      escaped.contains,
      10,
    ])

    searchSessionsByTitle('  ')
    expect(calls[1]?.sql).not.toContain('LIKE')
    expect(calls[1]?.sql).toContain('ORDER BY last_user_msg_at DESC')
    expect(calls[1]?.args).toEqual([50])

    const plain = sessionTitleLikePatterns('a')
    searchSessionsByTitle('a', 5, ['/work/a', '/work/b'])
    expect(calls[2]?.sql).toContain('p.path IN (?,?)')
    expect(calls[2]?.args).toEqual([
      plain.subsequence,
      '/work/a',
      '/work/b',
      plain.prefix,
      ...plain.wordPrefix,
      plain.contains,
      5,
    ])
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

  it('tells the delete watchers which sessions went, from every delete path', () => {
    // The sync zone and its transfer jobs are reclaimed off this signal; a
    // cleanup wired to one IPC handler was missed by "delete older" and session_cleanup.
    const deleted: string[][] = []
    const unwatch = watchSessionDeletes((ids) => deleted.push(ids))
    try {
      getProjectIdMock.mockReturnValue('proj-1')
      const allMock = vi.fn().mockReturnValue([{ id: 'old-1' }, { id: 'old-2' }])
      const getMock = vi.fn().mockReturnValue({ path: '/tmp/project' })
      const prepareMock = vi.fn().mockReturnValue({ all: allMock, run: vi.fn(), get: getMock })
      getDbMock.mockReturnValue({ prepare: prepareMock })
      deleteSessionsOlderThan('/tmp/project', '2026-02-01T00:00:00.000Z')
      deleteSession('single')
      expect(deleted).toEqual([['old-1', 'old-2'], ['single']])
    } finally {
      unwatch()
    }
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

describe('countMessagesForSessions', () => {
  beforeEach(() => { getDbMock.mockReset() })

  it('asks once for the whole page and reads a missing session as zero', () => {
    const all = vi.fn(() => [{ session_id: 's1', count: 7 }, { session_id: 's3', count: 1 }])
    const prepareMock = vi.fn(() => ({ all }))
    getDbMock.mockReturnValue({ prepare: prepareMock })

    const counts = countMessagesForSessions(['s1', 's2', 's3'])

    expect(prepareMock).toHaveBeenCalledTimes(1)
    expect(prepareMock.mock.calls[0][0]).toContain('IN (?,?,?)')
    expect(all).toHaveBeenCalledWith('s1', 's2', 's3')
    expect(counts.get('s1')).toBe(7)
    expect(counts.get('s2')).toBeUndefined()
    expect(counts.get('s3')).toBe(1)
  })

  it('does not touch the database for an empty page', () => {
    const prepareMock = vi.fn()
    getDbMock.mockReturnValue({ prepare: prepareMock })
    expect(countMessagesForSessions([]).size).toBe(0)
    expect(prepareMock).not.toHaveBeenCalled()
  })
})

describe('settleSession speech cache', () => {
  beforeEach(() => { clearSpeechCacheMock.mockClear() })

  function dbWithMessages(ids: string[]) {
    getDbMock.mockReturnValue({
      prepare: (sql: string) => ({
        all: () => (sql.includes('chat_messages') ? ids.map((id) => ({ id })) : []),
        get: () => (sql.includes('JOIN projects') ? { path: '/tmp/project' } : undefined),
        run: () => {},
      }),
    })
  }

  it('clears saved read-aloud audio when a session is settled', async () => {
    dbWithMessages(['m1', 'm2'])
    settleSession('session-1', true)
    await vi.waitFor(() => expect(clearSpeechCacheMock).toHaveBeenCalledWith(['m1', 'm2']))
  })

  it('leaves saved read-aloud audio when a session is unsettled', async () => {
    dbWithMessages(['m1'])
    settleSession('session-1', false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(clearSpeechCacheMock).not.toHaveBeenCalled()
  })
})

describe('settleSpawnChildren', () => {
  it('settles spawn children and marks them read', () => {
    const runs: Array<{ sql: string; params: unknown[] }> = []
    getDbMock.mockReturnValue({
      prepare: (sql: string) => ({
        all: () => (sql.includes('session_collaboration_grants') ? [{ id: 'spawn-1' }, { id: 'parent-1' }] : []),
        get: () => {
          if (sql.includes('seen_completed_message_id')) return { receipt: '' }
          if (sql.includes('JOIN projects')) return { path: '/tmp/project' }
          return undefined
        },
        run: (...params: unknown[]) => { runs.push({ sql, params }) },
      }),
    })

    clearSpeechCacheMock.mockClear()
    expect(settleSpawnChildren('parent-1')).toEqual(['spawn-1'])
    expect(clearSpeechCacheMock).not.toHaveBeenCalled()
    expect(runs).toEqual([
      { sql: 'UPDATE sessions SET is_settled = ? WHERE id = ?', params: [1, 'spawn-1'] },
      { sql: 'UPDATE sessions SET seen_completed_message_id = ? WHERE id = ?', params: [null, 'spawn-1'] },
    ])
  })
})

it('lists external-parent children through the local environment with project and visibility filters', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE sessions (
    id TEXT, project_id TEXT, title TEXT, created_at TEXT, is_worktree INTEGER, is_pinned INTEGER,
    is_hidden INTEGER DEFAULT 0, is_settled INTEGER DEFAULT 0, git_branch TEXT, worktree_path TEXT,
    is_automation INTEGER, automation_id TEXT, provider_session_id TEXT, provider_id TEXT, provider TEXT,
    acp_agent_id TEXT, selected_model TEXT, tags_json TEXT, remote_controller_json TEXT,
    seen_completed_message_id TEXT, last_user_message_at TEXT
  ); CREATE TABLE session_collaboration_grants (child_session_id TEXT, parent_session_id TEXT, kind TEXT, config_json TEXT);`)
  const insert = db.prepare('INSERT INTO sessions (id, project_id, title, created_at, remote_controller_json, is_settled) VALUES (?, ?, ?, ?, ?, ?)')
  for (const [id, project, parent, settled] of [['child', 'p', 'external-parent', 0], ['other', 'p', 'other-parent', 0], ['elsewhere', 'other', 'external-parent', 0], ['settled', 'p', 'external-parent', 1]] as const) {
    insert.run(id, project, id, '2026-11-06T00:00:00Z', JSON.stringify({ clientSessionId: 'c', externalParent: { sessionId: parent } }), settled)
  }
  getDbMock.mockReturnValue(db)
  try {
    const children = listSessionsForProjectId('p', 20, 0, { parentSessionId: 'external-parent' })
    expect(children.map((row) => row.sessionId)).toEqual(['child'])
    expect(children[0]?.parentSessionId).toBe('external-parent')
    expect(listSessionsForProjectId('p', 20, 0, { rootsOnly: true }).map((row) => row.sessionId)).toContain('child')
  } finally { db.close() }
})
