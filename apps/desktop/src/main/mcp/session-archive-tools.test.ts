import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'

const { getDbMock, getProjectIdMock, loadSessionStateMock, sessionBelongsMock, hideSessionMock, deleteSessionMock } =
  vi.hoisted(() => ({
    getDbMock: vi.fn(),
    getProjectIdMock: vi.fn(),
    loadSessionStateMock: vi.fn(),
    sessionBelongsMock: vi.fn(),
    hideSessionMock: vi.fn(),
    deleteSessionMock: vi.fn(),
  }))

vi.mock('../database', () => ({ getDb: getDbMock }))
vi.mock('../recent-folders', () => ({ getProjectId: getProjectIdMock }))
vi.mock('../db-sessions', () => ({
  loadSessionState: loadSessionStateMock,
  sessionBelongsToProject: sessionBelongsMock,
  hideSession: hideSessionMock,
  deleteSession: deleteSessionMock,
}))
vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  _resetSessionCleanupConfirmsForTests,
  parseSessionListOrder,
  resolveSessionCleanupConfirm,
  sessionCleanupHandler,
  sessionListHandler,
  sessionReadHandler,
  sessionSearchHandler,
  SESSION_LIST_DEFAULT_ORDER,
  SESSION_LIST_ORDERS,
} from './session-archive-tools'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

function textResult(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? ''
}

function makeDeps(overrides?: Partial<BuiltInSuperoneToolDeps>): BuiltInSuperoneToolDeps {
  const emitHostEvent = vi.fn()
  return {
    sessionId: 'self-session',
    sessionHost: {
      getSession: (id: string) =>
        id === 'self-session'
          ? { setTitle: vi.fn(), projectPath: '/tmp/proj', emitHostEvent }
          : null,
    },
    notifyDevAppReady: vi.fn(),
    applyAppSettings: vi.fn(),
    ...overrides,
  }
}

describe('session archive tools', () => {
  beforeEach(() => {
    getDbMock.mockReset()
    getProjectIdMock.mockReset().mockReturnValue('proj-1')
    loadSessionStateMock.mockReset()
    sessionBelongsMock.mockReset().mockReturnValue(true)
    hideSessionMock.mockReset()
    deleteSessionMock.mockReset()
    _resetSessionCleanupConfirmsForTests()
  })

  it('session_list returns project sessions with message counts', () => {
    const baseRow = {
      created_at: '2026-01-01T00:00:00.000Z',
      last_user_msg_at: '2026-01-02T00:00:00.000Z',
      is_worktree: 0,
      is_pinned: 1,
      is_hidden: 0,
      git_branch: 'main',
      worktree_path: null,
      is_automation: 0,
      provider_id: 'claude-base',
      provider: 'claude',
      acp_agent_id: null,
      parent_session_id: null,
      message_count: 12,
      selected_model: null,
      total_cost_usd: 0,
      context_tokens: 0,
    }
    // Default SQL selects NULL AS size_bytes — mock mirrors that.
    getDbMock.mockReturnValue({
      prepare: () => ({
        all: () => [
          { ...baseRow, id: 's1', title: 'Auth work', size_bytes: null },
          {
            ...baseRow,
            id: 'self-session',
            title: 'Current',
            last_user_msg_at: '2026-01-03T00:00:00.000Z',
            is_pinned: 0,
            git_branch: null,
            provider_id: 'codex-base',
            provider: 'codex',
            message_count: 2,
            size_bytes: null,
          },
        ],
      }),
    })

    const result = sessionListHandler({}, makeDeps())
    const text = textResult(result)
    expect(text).toContain('s1')
    expect(text).toContain('Auth work')
    expect(text).toContain('self-session')
    expect(text).toContain('messageCount')
    expect(text).not.toContain('sizeBytes')
    expect(text).toContain(SESSION_LIST_DEFAULT_ORDER)

    // size_* order selects the correlated size subquery — mock returns numeric size_bytes.
    getDbMock.mockReturnValue({
      prepare: () => ({
        all: () => [{ ...baseRow, id: 's1', title: 'Auth work', size_bytes: 4096 }],
      }),
    })
    const sized = textResult(sessionListHandler({ order: 'size_desc' }, makeDeps()))
    expect(sized).toContain('sizeBytes')
    expect(sized).toContain('4096')
  })

  it('parseSessionListOrder accepts known values and defaults', () => {
    expect(parseSessionListOrder(undefined)).toBe(SESSION_LIST_DEFAULT_ORDER)
    expect(parseSessionListOrder('last_active_asc')).toBe('last_active_asc')
    expect(parseSessionListOrder('message_count_desc')).toBe('message_count_desc')
    expect(parseSessionListOrder('size_desc')).toBe('size_desc')
    expect(parseSessionListOrder('size_asc')).toBe('size_asc')
    expect(parseSessionListOrder('not_a_sort')).toBeNull()
    expect(SESSION_LIST_ORDERS).toContain('created_asc')
    expect(SESSION_LIST_ORDERS).toContain('size_desc')
  })

  it('session_list rejects invalid order and applies order in SQL', () => {
    const prepare = vi.fn(() => ({ all: () => [] }))
    getDbMock.mockReturnValue({ prepare })

    const bad = sessionListHandler({ order: 'nope' as 'last_active_desc' }, makeDeps())
    expect(textResult(bad)).toContain('Invalid order')
    expect(prepare).not.toHaveBeenCalled()

    sessionListHandler({ order: 'message_count_asc', limit: 10 }, makeDeps())
    expect(prepare).toHaveBeenCalledTimes(1)
    const sql = prepare.mock.calls[0]![0] as string
    expect(sql).toMatch(/ORDER BY message_count ASC/)
    // Non-size orders use NULL size_bytes (no correlated SUM subquery).
    expect(sql).toMatch(/NULL AS size_bytes/)
    expect(sql).not.toMatch(/SUM\(LENGTH/)
  })

  it('session_list last_active_asc uses ascending activity order', () => {
    const prepare = vi.fn(() => ({ all: () => [] }))
    getDbMock.mockReturnValue({ prepare })

    const result = sessionListHandler({ order: 'last_active_asc' }, makeDeps())
    expect(textResult(result)).toContain('last_active_asc')
    const sql = prepare.mock.calls[0]![0] as string
    expect(sql).toMatch(/ORDER BY last_user_msg_at ASC/)
    expect(sql).toMatch(/NULL AS size_bytes/)
  })

  it('session_list size_desc orders by stored transcript size', () => {
    const prepare = vi.fn(() => ({ all: () => [] }))
    getDbMock.mockReturnValue({ prepare })

    const result = sessionListHandler({ order: 'size_desc' }, makeDeps())
    expect(textResult(result)).toContain('size_desc')
    const sql = prepare.mock.calls[0]![0] as string
    expect(sql).toMatch(/ORDER BY size_bytes DESC/)
    expect(sql).toMatch(/LENGTH\(m\.content_json\)/)
  })

  it('session_read meta and user/assistant views', () => {
    const messages: ChatMessage[] = [
      {
        id: 'm1',
        role: 'user',
        status: 'complete',
        content: [{ type: 'text', text: 'Please fix auth' }],
        createdAt: '2026-01-01T00:00:00.000Z',
        providerId: 'claude',
      },
      {
        id: 'm2',
        role: 'assistant',
        status: 'complete',
        content: [
          { type: 'text', text: 'Fixed.' },
          {
            type: 'tool_use',
            toolName: 'Edit',
            toolUseId: 't1',
            input: JSON.stringify({ file_path: 'auth.ts' }),
            status: 'complete',
          },
        ],
        createdAt: '2026-01-01T00:01:00.000Z',
        providerId: 'claude',
      },
    ]

    getDbMock.mockReturnValue({
      prepare: (sql: string) => {
        if (sql.includes('FROM sessions WHERE id')) {
          return {
            get: () => ({
              id: 'other',
              title: 'Auth',
              created_at: '2026-01-01T00:00:00.000Z',
              last_user_message_at: '2026-01-01T00:01:00.000Z',
              is_worktree: 0,
              is_pinned: 0,
              is_hidden: 0,
              git_branch: null,
              worktree_path: null,
              provider_id: 'claude-base',
              provider: 'claude',
              acp_agent_id: null,
              selected_model: 'opus',
              selected_effort: null,
              total_cost_usd: 1.2,
              context_tokens: 1000,
              api_provider_id: null,
            }),
          }
        }
        if (sql.includes('parent_session_id')) {
          return { get: () => undefined }
        }
        if (sql.includes('COUNT(*)')) {
          return { get: () => ({ n: 2 }) }
        }
        return { get: () => undefined, all: () => [] }
      },
    })
    loadSessionStateMock.mockReturnValue({ messages })

    const meta = sessionReadHandler({ sessionId: 'other', view: 'meta' }, makeDeps())
    expect(JSON.parse(textResult(meta))).toMatchObject({
      status: 'ok',
      view: 'meta',
      title: 'Auth',
      harness: 'claude',
      messageCount: 2,
    })

    const user = sessionReadHandler({ sessionId: 'other', view: 'user' }, makeDeps())
    const userText = textResult(user)
    expect(userText).toContain('Please fix auth')
    expect(userText).not.toContain('Fixed.')
    expect(userText).not.toContain('Edit')

    const assistant = sessionReadHandler({ sessionId: 'other', view: 'assistant' }, makeDeps())
    const aText = textResult(assistant)
    expect(aText).toContain('Fixed.')
    expect(aText).toContain('tools:1')
    expect(aText).not.toContain('file_path')

    const tools = sessionReadHandler({ sessionId: 'other', view: 'tools' }, makeDeps())
    expect(textResult(tools)).toContain('Edit')
    expect(textResult(tools)).toContain('auth.ts')
    expect(textResult(tools)).toContain('t1')

    const detail = sessionReadHandler(
      { sessionId: 'other', view: 'tool_detail', toolUseId: 't1' },
      makeDeps(),
    )
    expect(JSON.parse(textResult(detail)).tool).toMatchObject({
      toolUseId: 't1',
      toolName: 'Edit',
    })
  })

  it('session_search finds messages by text', () => {
    getDbMock.mockReturnValue({
      prepare: () => ({
        all: () => [
          {
            message_id: 'm1',
            session_id: 's1',
            role: 'user',
            created_at: '2026-01-01T00:00:00.000Z',
            content_json: JSON.stringify({ content: [{ type: 'text', text: 'refresh token middleware' }] }),
            title: 'Auth session',
            provider_id: 'claude-base',
            provider: 'claude',
            acp_agent_id: null,
          },
        ],
      }),
    })

    const result = sessionSearchHandler({ query: 'refresh token' }, makeDeps())
    const parsed = textResult(result)
    expect(parsed).toContain('s1')
    expect(parsed).toContain('m1')
    expect(parsed).toContain('refresh')
  })

  it('session_cleanup hide + delete with user confirm (no preview)', async () => {
    const rows = [
      {
        id: 'old-1',
        title: 'Old chat',
        created_at: '2025-01-01T00:00:00.000Z',
        last_user_msg_at: '2025-01-01T00:00:00.000Z',
        is_worktree: 0,
        is_pinned: 0,
        is_hidden: 0,
        git_branch: null,
        worktree_path: null,
        is_automation: 0,
        provider_id: 'claude-base',
        provider: 'claude',
        acp_agent_id: null,
        parent_session_id: null,
        message_count: 3,
        size_bytes: 256,
        selected_model: null,
        total_cost_usd: 0,
        context_tokens: 0,
      },
    ]

    getDbMock.mockReturnValue({
      prepare: (sql: string) => {
        if (sql.includes('FROM session_collaboration_grants') && sql.includes('parent_session_id')) {
          return { all: () => [] }
        }
        if (sql.includes('SELECT is_pinned FROM sessions')) {
          return { get: () => ({ is_pinned: 0 }) }
        }
        // session id IN (...) lookup for cleanup candidates
        return {
          all: () => rows,
          get: () => undefined,
        }
      },
    })

    const deps = makeDeps()

    await sessionCleanupHandler({ action: 'hide', sessionIds: ['old-1'] }, deps)
    expect(hideSessionMock).toHaveBeenCalledWith('old-1', true)

    // delete: open host confirm then accept (no confirmToken / preview)
    const session = deps.sessionHost!.getSession('self-session')!
    const emit = session.emitHostEvent as ReturnType<typeof vi.fn>
    const deletePromise = sessionCleanupHandler(
      { action: 'delete', sessionIds: ['old-1'] },
      deps,
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(emit).toHaveBeenCalled()
    const req = emit.mock.calls[0][0]
    expect(req.type).toBe('permission_request')
    expect(req.request.requestKind).toBe('session_cleanup_confirm')
    expect(req.request.sessionCleanupConfirm?.sessions).toEqual([
      expect.objectContaining({ id: 'old-1', title: 'Old chat' }),
    ])
    resolveSessionCleanupConfirm(req.request.requestId, 'accept')
    const deleted = await deletePromise
    expect(JSON.parse(textResult(deleted))).toMatchObject({
      status: 'ok',
      action: 'delete',
      deleted: [{ id: 'old-1', title: 'Old chat' }],
    })
    expect(deleteSessionMock).toHaveBeenCalledWith('old-1')
  })

  it('session_cleanup requires sessionIds', async () => {
    const result = await sessionCleanupHandler(
      { action: 'hide', sessionIds: [] as unknown as string[] },
      makeDeps(),
    )
    expect(result.isError).toBe(true)
    expect(textResult(result)).toMatch(/sessionIds is required/i)
  })

  it('session_cleanup delete dismisses host confirm when tool AbortSignal aborts', async () => {
    const rows = [
      {
        id: 'old-1',
        title: 'Old chat',
        created_at: '2025-01-01T00:00:00.000Z',
        last_user_msg_at: '2025-01-01T00:00:00.000Z',
        is_worktree: 0,
        is_pinned: 0,
        is_hidden: 0,
        git_branch: null,
        worktree_path: null,
        is_automation: 0,
        provider_id: 'claude-base',
        provider: 'claude',
        acp_agent_id: null,
        parent_session_id: null,
        message_count: 3,
        size_bytes: 256,
        selected_model: null,
        total_cost_usd: 0,
        context_tokens: 0,
      },
    ]

    getDbMock.mockReturnValue({
      prepare: (sql: string) => {
        if (sql.includes('FROM session_collaboration_grants') && sql.includes('parent_session_id')) {
          return { all: () => [] }
        }
        if (sql.includes('SELECT is_pinned FROM sessions')) {
          return { get: () => ({ is_pinned: 0 }) }
        }
        return { all: () => rows, get: () => undefined }
      },
    })

    const controller = new AbortController()
    const deps = makeDeps({ signal: controller.signal })
    const session = deps.sessionHost!.getSession('self-session')!
    const emit = session.emitHostEvent as ReturnType<typeof vi.fn>

    const deletePromise = sessionCleanupHandler({ action: 'delete', sessionIds: ['old-1'] }, deps)
    await new Promise((r) => setTimeout(r, 0))
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'permission_request' }))
    const requestId = (emit.mock.calls[0]![0] as { request: { requestId: string } }).request.requestId

    controller.abort()
    const result = await deletePromise
    // Abort is a neutral cancel (same as collab), not a tool error.
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(textResult(result))).toMatchObject({
      status: 'cancelled',
      action: 'delete',
    })
    expect(textResult(result)).toMatch(/cancelled/i)
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'interaction_resolved',
      interactionType: 'permission',
      requestId,
      approved: false,
    }))
    expect(deleteSessionMock).not.toHaveBeenCalled()
  })

  it('session_cleanup reports omittedDueToMaxDelete when cap truncates', async () => {
    const mk = (id: string) => ({
      id,
      title: id,
      created_at: '2025-01-01T00:00:00.000Z',
      last_user_msg_at: '2025-01-01T00:00:00.000Z',
      is_worktree: 0,
      is_pinned: 0,
      is_hidden: 0,
      git_branch: null,
      worktree_path: null,
      is_automation: 0,
      provider_id: 'claude-base',
      provider: 'claude',
      acp_agent_id: null,
      parent_session_id: null,
      message_count: 1,
      size_bytes: null,
      selected_model: null,
      total_cost_usd: 0,
      context_tokens: 0,
    })
    const rows = [mk('a'), mk('b'), mk('c')]
    getDbMock.mockReturnValue({
      prepare: (sql: string) => {
        if (sql.includes('FROM session_collaboration_grants') && sql.includes('parent_session_id')) {
          return { all: () => [] }
        }
        return { all: () => rows, get: () => undefined }
      },
    })

    const result = await sessionCleanupHandler(
      { action: 'hide', sessionIds: ['a', 'b', 'c'], maxDelete: 2 },
      makeDeps(),
    )
    expect(JSON.parse(textResult(result))).toMatchObject({
      status: 'ok',
      action: 'hide',
      affected: [{ id: 'a' }, { id: 'b' }],
      omittedDueToMaxDelete: ['c'],
    })
  })

  it('session_cleanup delete returns partial when some deleteSession calls fail', async () => {
    const rows = [
      {
        id: 'old-1',
        title: 'One',
        created_at: '2025-01-01T00:00:00.000Z',
        last_user_msg_at: '2025-01-01T00:00:00.000Z',
        is_worktree: 0,
        is_pinned: 0,
        is_hidden: 0,
        git_branch: null,
        worktree_path: null,
        is_automation: 0,
        provider_id: 'claude-base',
        provider: 'claude',
        acp_agent_id: null,
        parent_session_id: null,
        message_count: 1,
        size_bytes: null,
        selected_model: null,
        total_cost_usd: 0,
        context_tokens: 0,
      },
      {
        id: 'old-2',
        title: 'Two',
        created_at: '2025-01-01T00:00:00.000Z',
        last_user_msg_at: '2025-01-01T00:00:00.000Z',
        is_worktree: 0,
        is_pinned: 0,
        is_hidden: 0,
        git_branch: null,
        worktree_path: null,
        is_automation: 0,
        provider_id: 'claude-base',
        provider: 'claude',
        acp_agent_id: null,
        parent_session_id: null,
        message_count: 1,
        size_bytes: null,
        selected_model: null,
        total_cost_usd: 0,
        context_tokens: 0,
      },
    ]

    getDbMock.mockReturnValue({
      prepare: (sql: string) => {
        if (sql.includes('FROM session_collaboration_grants') && sql.includes('parent_session_id')) {
          return { all: () => [] }
        }
        if (sql.includes('SELECT is_pinned FROM sessions')) {
          return { get: () => ({ is_pinned: 0 }) }
        }
        return { all: () => rows, get: () => undefined }
      },
    })

    deleteSessionMock.mockImplementation((id: string) => {
      if (id === 'old-2') throw new Error('disk full')
    })

    const deps = makeDeps()
    const session = deps.sessionHost!.getSession('self-session')!
    const emit = session.emitHostEvent as ReturnType<typeof vi.fn>
    const deletePromise = sessionCleanupHandler(
      { action: 'delete', sessionIds: ['old-1', 'old-2'] },
      deps,
    )
    await new Promise((r) => setTimeout(r, 0))
    const req = emit.mock.calls[0]![0] as { request: { requestId: string } }
    resolveSessionCleanupConfirm(req.request.requestId, 'accept')
    const result = await deletePromise
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(textResult(result))).toMatchObject({
      status: 'partial',
      action: 'delete',
      deleted: [{ id: 'old-1', title: 'One' }],
      failed: [{ id: 'old-2', title: 'Two', error: 'disk full' }],
    })
  })

  it('rejects cross-project session_read', () => {
    sessionBelongsMock.mockReturnValue(false)
    const result = sessionReadHandler({ sessionId: 'x', view: 'meta' }, makeDeps())
    expect(result.isError).toBe(true)
    expect(textResult(result)).toMatch(/not found in the current project/i)
  })
})
