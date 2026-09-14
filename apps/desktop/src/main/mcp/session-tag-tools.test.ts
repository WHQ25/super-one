import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDbMock,
  getSessionTagsMock,
  setSessionTagsMock,
  isSessionUserRenamedMock,
  dbRenameSessionMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getSessionTagsMock: vi.fn(),
  setSessionTagsMock: vi.fn(),
  isSessionUserRenamedMock: vi.fn(() => false),
  dbRenameSessionMock: vi.fn(),
}))

vi.mock('../database', () => ({ getDb: getDbMock }))
vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../recent-folders', () => ({
  getProjectId: (path: string) => (path === '/tmp/proj' ? 'proj-1' : null),
  getProjectPathById: (id: string) => (id === 'proj-1' ? '/tmp/proj' : null),
  getRecentFolders: () => [],
}))
vi.mock('../db-sessions', () => ({
  getSessionTags: getSessionTagsMock,
  setSessionTags: setSessionTagsMock,
  isSessionUserRenamed: isSessionUserRenamedMock,
  renameSession: dbRenameSessionMock,
}))

import { sessionRenameHandler, sessionTagHandler, sessionTagListHandler } from './session-tag-tools'
import { noteAcpTaskLifecycle, _resetMainThreadSessionGuardForTests } from './main-thread-session-guard'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

function textResult(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? ''
}

function makeDeps(): BuiltInSuperoneToolDeps {
  return {
    sessionId: 'self-session',
    sessionHost: {
      getSession: (id: string) =>
        id === 'self-session' ? { setTitle: vi.fn(), projectPath: '/tmp/proj' } : null,
    },
    notifyDevAppReady: vi.fn(),
    applyAppSettings: vi.fn(),
  }
}

describe('session_tag', () => {
  beforeEach(() => {
    getSessionTagsMock.mockReset()
    setSessionTagsMock.mockReset()
    isSessionUserRenamedMock.mockReset()
    dbRenameSessionMock.mockReset()
    getSessionTagsMock.mockImplementation((id: string) => (id === 'missing' ? null : ['oauth']))
    setSessionTagsMock.mockReturnValue(true)
    isSessionUserRenamedMock.mockReturnValue(false)
    _resetMainThreadSessionGuardForTests()
  })

  it('denies when an ACP subagent is live and the parent has no grant', () => {
    noteAcpTaskLifecycle('self-session', { type: 'task_started', taskId: 'sa-1', taskType: 'general-purpose' })
    const result = sessionTagHandler({ add: ['subagent-should-fail'] }, makeDeps())
    expect(result.isError).toBe(true)
    expect(textResult(result)).toMatch(/main thread/i)
    expect(setSessionTagsMock).not.toHaveBeenCalled()
  })

  it('defaults to the current session and adds tags', () => {
    const result = sessionTagHandler({ add: ['Auth'] }, makeDeps())
    expect(result.isError).toBeUndefined()
    expect(getSessionTagsMock).toHaveBeenCalledWith('self-session')
    expect(setSessionTagsMock).toHaveBeenCalledWith('self-session', ['oauth', 'auth'])
    expect(textResult(result)).toContain('"auth"')
  })

  it('bulk-adds to sessionIds', () => {
    const result = sessionTagHandler({ sessionIds: ['a', 'b'], add: ['desktop'] }, makeDeps())
    expect(setSessionTagsMock).toHaveBeenCalledTimes(2)
    expect(textResult(result)).toContain('"count"')
  })

  it('rejects add+set together and empty add', () => {
    expect(sessionTagHandler({ add: ['a'], set: [] }, makeDeps()).isError).toBe(true)
    expect(sessionTagHandler({ add: [] }, makeDeps()).isError).toBe(true)
  })

  it('reports missing sessions', () => {
    const result = sessionTagHandler({ sessionId: 'missing', add: ['x'] }, makeDeps())
    expect(textResult(result)).toMatch(/missing/)
    expect(setSessionTagsMock).not.toHaveBeenCalled()
  })

  it('rejects bulk sessionIds with set or remove', () => {
    expect(sessionTagHandler({ sessionIds: ['a'], set: ['x'] }, makeDeps()).isError).toBe(true)
    expect(sessionTagHandler({ sessionIds: ['a'], remove: ['oauth'] }, makeDeps()).isError).toBe(true)
    expect(setSessionTagsMock).not.toHaveBeenCalled()
  })
})

describe('session_rename tags', () => {
  beforeEach(() => {
    getSessionTagsMock.mockReset()
    setSessionTagsMock.mockReset()
    isSessionUserRenamedMock.mockReset()
    dbRenameSessionMock.mockReset()
    getSessionTagsMock.mockImplementation((id: string) => (id === 'missing' ? null : ['oauth']))
    setSessionTagsMock.mockReturnValue(true)
    isSessionUserRenamedMock.mockReturnValue(false)
    _resetMainThreadSessionGuardForTests()
  })

  it('does not apply tags when the title is empty', () => {
    const result = sessionRenameHandler({ title: '   ', tags: ['desktop'] }, makeDeps())
    expect(result.isError).toBe(true)
    expect(textResult(result)).toMatch(/empty title/)
    expect(setSessionTagsMock).not.toHaveBeenCalled()
  })

  it('still writes tags when the title is user_locked', () => {
    isSessionUserRenamedMock.mockReturnValue(true)
    const result = sessionRenameHandler({ title: 'New Title', tags: ['desktop'] }, makeDeps())
    expect(result.isError).toBe(true)
    expect(textResult(result)).toMatch(/user_locked/)
    expect(setSessionTagsMock).toHaveBeenCalledWith('self-session', ['desktop'])
  })
})

describe('session_tag_list', () => {
  const rows = [
    { tag: 'oauth', sessions: 3 },
    { tag: 'pr-456', sessions: 2 },
    { tag: 'auth', sessions: 1 },
    { tag: 'issue-123', sessions: 1 },
  ]
  let prepare: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getDbMock.mockReset()
    prepare = vi.fn(() => ({ all: () => rows }))
    getDbMock.mockReturnValue({ prepare })
  })

  it('aggregates label tags for the current project and hides refs by default', () => {
    const text = textResult(sessionTagListHandler({}, makeDeps()))
    expect(text).toContain('oauth')
    expect(text).toContain('auth')
    expect(text).not.toContain('pr-456')
    expect(text).not.toContain('issue-123')
    expect(text).toContain('proj-1')
    expect(text).toContain('kind: label')
    expect(text).toContain('total: 2')
    const sql = prepare.mock.calls[0][0] as string
    expect(sql).toMatch(/json_each/)
    expect(sql).toMatch(/s\.project_id = \?/)
    expect(sql).not.toMatch(/last_user_message_at/)
    expect(sql).not.toMatch(/LIMIT/)
  })

  it('lists only issue-N / pr-N with kind=ref', () => {
    const text = textResult(sessionTagListHandler({ kind: 'ref' }, makeDeps()))
    expect(text).toContain('pr-456')
    expect(text).toContain('issue-123')
    expect(text).not.toContain('oauth')
    expect(text).toContain('total: 2')
  })

  it('paginates in JS after the kind split', () => {
    const text = textResult(sessionTagListHandler({ kind: 'all', limit: 3, offset: 2 }, makeDeps()))
    expect(text).toContain('auth')
    expect(text).toContain('issue-123')
    expect(text).not.toContain('oauth')
    expect(text).toContain('count: 2')
    expect(text).toContain('total: 4')
  })

  it('rejects an unknown kind', () => {
    const result = sessionTagListHandler({ kind: 'bogus' }, makeDeps())
    expect(result.isError).toBe(true)
    expect(textResult(result)).toMatch(/kind must be/)
  })
})
