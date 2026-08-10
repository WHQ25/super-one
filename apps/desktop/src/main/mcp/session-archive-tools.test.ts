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
  _resetSessionCleanupTokensForTests,
  resolveSessionCleanupConfirm,
  sessionCleanupHandler,
  sessionListHandler,
  sessionReadHandler,
  sessionSearchHandler,
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
    _resetSessionCleanupTokensForTests()
  })

  it('session_list returns project sessions with message counts', () => {
    const rows = [
      {
        id: 's1',
        title: 'Auth work',
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
      },
      {
        id: 'self-session',
        title: 'Current',
        created_at: '2026-01-03T00:00:00.000Z',
        last_user_msg_at: '2026-01-03T00:00:00.000Z',
        is_worktree: 0,
        is_pinned: 0,
        is_hidden: 0,
        git_branch: null,
        worktree_path: null,
        is_automation: 0,
        provider_id: 'codex-base',
        provider: 'codex',
        acp_agent_id: null,
        parent_session_id: null,
        message_count: 2,
        selected_model: null,
        total_cost_usd: 0,
        context_tokens: 0,
      },
    ]
    getDbMock.mockReturnValue({
      prepare: () => ({ all: () => rows }),
    })

    const result = sessionListHandler({}, makeDeps())
    const text = textResult(result)
    expect(text).toContain('s1')
    expect(text).toContain('Auth work')
    expect(text).toContain('self-session')
    expect(text).toContain('messageCount')
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

  it('session_cleanup preview + hide + delete with confirm', async () => {
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
    const preview = await sessionCleanupHandler(
      { action: 'preview', sessionIds: ['old-1'] },
      deps,
    )
    const previewBody = JSON.parse(textResult(preview))
    expect(previewBody.candidates).toHaveLength(1)
    expect(previewBody.confirmToken).toBeTruthy()

    await sessionCleanupHandler({ action: 'hide', sessionIds: ['old-1'] }, deps)
    expect(hideSessionMock).toHaveBeenCalledWith('old-1', true)

    // delete: open confirm then accept
    const session = deps.sessionHost!.getSession('self-session')!
    const emit = session.emitHostEvent as ReturnType<typeof vi.fn>
    const deletePromise = sessionCleanupHandler(
      { action: 'delete', sessionIds: ['old-1'], confirmToken: previewBody.confirmToken },
      deps,
    )
    // Wait a tick for open() to emit
    await new Promise((r) => setTimeout(r, 0))
    expect(emit).toHaveBeenCalled()
    const req = emit.mock.calls[0][0]
    expect(req.type).toBe('permission_request')
    resolveSessionCleanupConfirm(req.request.requestId, 'accept')
    const deleted = await deletePromise
    expect(JSON.parse(textResult(deleted))).toMatchObject({
      status: 'ok',
      action: 'delete',
      deleted: ['old-1'],
    })
    expect(deleteSessionMock).toHaveBeenCalledWith('old-1')
  })

  it('rejects cross-project session_read', () => {
    sessionBelongsMock.mockReturnValue(false)
    const result = sessionReadHandler({ sessionId: 'x', view: 'meta' }, makeDeps())
    expect(result.isError).toBe(true)
    expect(textResult(result)).toMatch(/not found in the current project/i)
  })
})
