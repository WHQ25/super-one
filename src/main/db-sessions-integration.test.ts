import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, getProjectIdMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getProjectIdMock: vi.fn(),
}))

vi.mock('./database', () => ({ getDb: getDbMock }))
vi.mock('./recent-folders', () => ({ getProjectId: getProjectIdMock }))

import { createSession, saveSessionState, loadSessionState } from './db-sessions'

function createMockDb() {
  const sessions = new Map<string, Record<string, unknown>>()
  const messages = new Map<string, Array<Record<string, unknown>>>()

  return {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT INTO sessions')) {
          const [id, projectId, claudeSessionId, title, createdAt, _lastUserMessageAt, isWorktree, gitBranch, worktreePath] = args as string[]
          const existing = [...sessions.values()].find((s) => s.claude_session_id === claudeSessionId)
          if (existing) {
            if (gitBranch != null) existing.git_branch = gitBranch
            if (worktreePath != null) existing.worktree_path = worktreePath
          } else {
            sessions.set(id, {
              id, project_id: projectId, claude_session_id: claudeSessionId,
              title, created_at: createdAt,
              is_worktree: isWorktree === '1' || isWorktree === (1 as unknown) ? 1 : 0,
              git_branch: gitBranch ?? null,
              worktree_path: worktreePath ?? null,
              total_cost_usd: 0, context_tokens: 0, provider: 'claude', is_pinned: 0,
            })
          }
        } else if (sql.includes('INSERT INTO chat_messages')) {
          const [msgId, claudeSessionId, sortOrder, role, status, contentJson, createdAt, providerId, metadataJson, checkpointId, resumePointId] = args as string[]
          if (!messages.has(claudeSessionId)) messages.set(claudeSessionId, [])
          const list = messages.get(claudeSessionId)!
          const existing = list.findIndex((m) => m.id === msgId)
          const msg = { id: msgId, claude_session_id: claudeSessionId, sort_order: sortOrder, role, status, content_json: contentJson, created_at: createdAt, provider_id: providerId, metadata_json: metadataJson, checkpoint_id: checkpointId, resume_point_id: resumePointId }
          if (existing >= 0) list[existing] = msg
          else list.push(msg)
        } else if (sql.includes('UPDATE sessions')) {
          const sessionId = args[args.length - 1] as string
          const session = [...sessions.values()].find((s) => s.claude_session_id === sessionId)
          if (session) {
            session.total_cost_usd = args[0]
            session.context_tokens = args[1]
            session.provider = args[2]
          }
        }
      }),
      get: vi.fn((...args: unknown[]) => {
        if (sql.includes('FROM sessions')) {
          return [...sessions.values()].find((s) => s.claude_session_id === args[0]) ?? undefined
        }
        return undefined
      }),
      all: vi.fn((...args: unknown[]) => {
        if (sql.includes('FROM chat_messages')) {
          return messages.get(args[0] as string) ?? []
        }
        return []
      }),
    })),
    transaction: vi.fn((fn: () => void) => fn),
  }
}

describe('session restore with worktree path', () => {
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
    getDbMock.mockReturnValue(mockDb)
    getProjectIdMock.mockReturnValue('proj-1')
  })

  it('should persist and restore worktree_path', () => {
    const wtPath = '/Users/me/.worktrees/project/abc1234'
    createSession('/tmp/project', 'session-wt-1', undefined, true, 'main', wtPath)
    saveSessionState('session-wt-1', {
      messages: [{ id: 'msg-1', role: 'user', status: 'complete', content: [{ type: 'text', text: 'hello' }], createdAt: '2026-01-01T00:00:00Z', providerId: 'claude' }],
      totalCostUsd: 0.1, contextTokens: 100,
    })

    const restored = loadSessionState('session-wt-1')

    expect(restored).not.toBeNull()
    expect(restored!.isWorktree).toBe(true)
    expect(restored!.gitBranch).toBe('main')
    expect(restored!.worktreePath).toBe(wtPath)
  })

  it('should return null worktree_path for non-worktree sessions', () => {
    createSession('/tmp/project', 'session-normal')
    saveSessionState('session-normal', {
      messages: [{ id: 'msg-2', role: 'user', status: 'complete', content: [{ type: 'text', text: 'hi' }], createdAt: '2026-01-01T00:00:00Z', providerId: 'claude' }],
      totalCostUsd: 0, contextTokens: 0,
    })

    const restored = loadSessionState('session-normal')

    expect(restored).not.toBeNull()
    expect(restored!.isWorktree).toBe(false)
    expect(restored!.worktreePath).toBeNull()
  })

  it('should preserve worktree_path on duplicate session upsert with null path', () => {
    const wtPath = '/Users/me/.worktrees/project/abc1234'
    createSession('/tmp/project', 'session-dup', undefined, true, 'main', wtPath)
    createSession('/tmp/project', 'session-dup', undefined, true, 'main')

    saveSessionState('session-dup', {
      messages: [{ id: 'msg-3', role: 'user', status: 'complete', content: [{ type: 'text', text: 'test' }], createdAt: '2026-01-01T00:00:00Z', providerId: 'claude' }],
      totalCostUsd: 0, contextTokens: 0,
    })

    const restored = loadSessionState('session-dup')
    expect(restored!.worktreePath).toBe(wtPath)
  })

  it('should update worktree_path on upsert when new value is provided', () => {
    createSession('/tmp/project', 'session-upd', undefined, true, 'main', '/old/path')
    createSession('/tmp/project', 'session-upd', undefined, true, 'main', '/new/path')

    saveSessionState('session-upd', {
      messages: [{ id: 'msg-4', role: 'user', status: 'complete', content: [{ type: 'text', text: 'test' }], createdAt: '2026-01-01T00:00:00Z', providerId: 'claude' }],
      totalCostUsd: 0, contextTokens: 0,
    })

    const restored = loadSessionState('session-upd')
    expect(restored!.worktreePath).toBe('/new/path')
  })

  it('should return null when session does not exist', () => {
    expect(loadSessionState('nonexistent')).toBeNull()
  })

  it('should return null when session has no messages', () => {
    createSession('/tmp/project', 'session-empty', undefined, true, 'main', '/some/path')
    expect(loadSessionState('session-empty')).toBeNull()
  })
})
