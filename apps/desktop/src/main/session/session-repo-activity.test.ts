import { beforeEach, describe, expect, it, vi } from 'vitest'
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

interface SessionRow {
  id: string
  project_id: string
  provider_id: string | null
  provider_session_id: string | null
  provider: string | null
  title: string | null
  created_at: string
  last_user_message_at: string | null
  total_cost_usd: number | null
  context_tokens: number | null
  is_worktree: number | null
  git_branch: string | null
  worktree_path: string | null
  is_pinned: number | null
  is_hidden: number | null
  api_provider_id: string | null
  usage_counted_at: string | null
}

interface MessageRow {
  id: string
  session_id: string
  sort_order: number
  role: string
  status: string
  content_json: string
  created_at: string
  provider_id: string
  metadata_json: string | null
  checkpoint_id: string | null
  resume_point_id: string | null
  usage_counted_at: string | null
}

interface ActivityRow {
  day: string
  harness: string
  sessions_started: number
  user_messages: number
  assistant_messages: number
}

function makeFakeDb() {
  const sessions = new Map<string, SessionRow>()
  const messages = new Map<string, MessageRow>()
  const activity = new Map<string, ActivityRow>()

  function activityKey(day: string, harness: string): string {
    return `${day}::${harness}`
  }

  const db = {
    prepare: (rawSql: string) => {
      const sql = rawSql.replace(/\s+/g, ' ').trim()

      if (/INSERT INTO sessions/.test(sql) && /provider_session_id/.test(sql) && /api_provider_id/.test(sql)) {
        return {
          run: (
            id: string,
            projectId: string,
            providerId: string,
            provider: string,
            providerSessionId: string | null,
            title: string | null,
            createdAt: string,
            lastUserMsg: string,
            isWorktree: number,
            gitBranch: string | null,
            worktreePath: string | null,
            apiProviderId: string | null,
          ) => {
            const existing = sessions.get(id)
            if (existing) {
              existing.provider_id = providerId
              existing.provider = provider
              existing.provider_session_id = existing.provider_id !== providerId
                ? providerSessionId
                : (providerSessionId ?? existing.provider_session_id)
              existing.is_worktree = isWorktree
              existing.git_branch = gitBranch
              existing.worktree_path = worktreePath
              existing.api_provider_id = apiProviderId
              return
            }
            sessions.set(id, {
              id, project_id: projectId,
              provider_id: providerId, provider,
              provider_session_id: providerSessionId,
              title,
              created_at: createdAt,
              last_user_message_at: lastUserMsg,
              total_cost_usd: 0, context_tokens: 0,
              is_worktree: isWorktree,
              git_branch: gitBranch, worktree_path: worktreePath,
              is_pinned: 0, is_hidden: 0,
              api_provider_id: apiProviderId,
              usage_counted_at: null,
            })
          },
        }
      }

      if (/SELECT created_at, usage_counted_at FROM sessions WHERE id/.test(sql)) {
        return {
          get: (id: string) => {
            const row = sessions.get(id)
            return row ? { created_at: row.created_at, usage_counted_at: row.usage_counted_at } : undefined
          },
        }
      }

      if (/SELECT id, usage_counted_at FROM chat_messages WHERE session_id/.test(sql)) {
        return {
          all: (sessionId: string) => Array.from(messages.values())
            .filter((m) => m.session_id === sessionId)
            .map((m) => ({ id: m.id, usage_counted_at: m.usage_counted_at })),
        }
      }

      if (/SELECT id FROM chat_messages WHERE session_id = \? AND usage_counted_at IS NOT NULL/.test(sql)) {
        return {
          all: (sessionId: string) => Array.from(messages.values())
            .filter((m) => m.session_id === sessionId && m.usage_counted_at !== null)
            .map((m) => ({ id: m.id })),
        }
      }

      if (/^UPDATE sessions SET usage_counted_at/.test(sql)) {
        return {
          run: (now: string, id: string) => {
            const row = sessions.get(id)
            if (row) row.usage_counted_at = now
          },
        }
      }

      if (/DELETE FROM chat_messages WHERE session_id = \? AND id = \?/.test(sql)) {
        return {
          run: (sessionId: string, id: string) => {
            const row = messages.get(id)
            if (row && row.session_id === sessionId) messages.delete(id)
          },
        }
      }

      if (/^DELETE FROM chat_messages WHERE session_id/.test(sql)) {
        return {
          run: (sessionId: string) => {
            for (const [k, v] of messages) if (v.session_id === sessionId) messages.delete(k)
          },
        }
      }

      if (/^INSERT INTO chat_messages/.test(sql)) {
        const includesUsageCounted = /usage_counted_at/.test(sql)
        return {
          run: (...args: unknown[]) => {
            const [
              msgId, sessionId, sortOrder, role, status, contentJson, createdAt,
              providerId, metadataJson, checkpointId, resumePointId,
            ] = args as [string, string, number, string, string, string, string, string, string | null, string | null, string | null]
            const usageCountedAt = includesUsageCounted ? (args[11] as string | null) : null
            const prev = messages.get(msgId)
            messages.set(msgId, {
              id: msgId, session_id: sessionId, sort_order: sortOrder,
              role, status, content_json: contentJson,
              created_at: createdAt, provider_id: providerId,
              metadata_json: metadataJson,
              checkpoint_id: checkpointId, resume_point_id: resumePointId,
              usage_counted_at: prev?.usage_counted_at ?? usageCountedAt,
            })
          },
        }
      }

      if (/^UPDATE sessions\s+SET total_cost_usd/.test(sql)) {
        return {
          run: (...args: unknown[]) => {
            const id = args[args.length - 1] as string
            const row = sessions.get(id)
            if (!row) return
            row.total_cost_usd = args[0] as number
            row.context_tokens = args[1] as number
            row.last_user_message_at = (args[2] as string | null) ?? row.last_user_message_at
          },
        }
      }

      if (/^INSERT INTO activity_daily/.test(sql)) {
        return {
          run: (day: string, harness: string, s: number, u: number, a: number) => {
            const key = activityKey(day, harness)
            const existing = activity.get(key)
            if (existing) {
              existing.sessions_started += s
              existing.user_messages += u
              existing.assistant_messages += a
            } else {
              activity.set(key, { day, harness, sessions_started: s, user_messages: u, assistant_messages: a })
            }
          },
        }
      }

      if (/SELECT\s+COALESCE\(SUM\(sessions_started\), 0\)/.test(sql)) {
        return {
          get: (...args: unknown[]) => {
            let i = 0
            let fromFilter: string | undefined
            let toFilter: string | undefined
            let harnessFilter: string | undefined
            if (/day >= \?/.test(sql)) fromFilter = args[i++] as string
            if (/day <= \?/.test(sql)) toFilter = args[i++] as string
            if (/harness = \?/.test(sql)) harnessFilter = args[i] as string

            let sessionsTotal = 0
            let messagesTotal = 0
            for (const r of activity.values()) {
              if (fromFilter && r.day < fromFilter) continue
              if (toFilter && r.day > toFilter) continue
              if (harnessFilter && r.harness !== harnessFilter) continue
              sessionsTotal += r.sessions_started
              messagesTotal += r.user_messages + r.assistant_messages
            }
            return { sessions: sessionsTotal, messages: messagesTotal }
          },
        }
      }

      throw new Error(`Unmocked SQL: ${sql.slice(0, 160)}`)
    },
    transaction: (fn: () => void) => () => fn(),
  }

  return { db, sessions, messages, activity }
}

describe('saveSessionStateBySid records activity stats', () => {
  let fake: ReturnType<typeof makeFakeDb>

  beforeEach(() => {
    fake = makeFakeDb()
    getDbMock.mockReturnValue(fake.db)
    getProjectIdMock.mockImplementation((path: string) => `proj_${path}`)
  })

  it('increments activity_daily.sessions_started on first save for a new session', async () => {
    const { saveSessionStateBySid } = await import('./session-repo')
    const { queryCounts } = await import('../usage-stats-service')

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', status: 'complete', content: [{ type: 'text', text: 'hi' }], createdAt: '2026-05-11T00:00:00Z', providerId: 'claude' },
      { id: 'a1', role: 'assistant', status: 'complete', content: [{ type: 'text', text: 'hello' }], createdAt: '2026-05-11T00:00:01Z', providerId: 'claude' },
    ]
    saveSessionStateBySid({
      sid: 's-today',
      projectPath: '/tmp/proj',
      providerId: 'claude-base',
      messages,
      totalCostUsd: 0,
      contextTokens: 0,
    })

    expect(queryCounts({})).toEqual({ sessions: 1, messages: 2 })
  })

  it('does not double-count sessions or messages on subsequent saves', async () => {
    const { saveSessionStateBySid } = await import('./session-repo')
    const { queryCounts } = await import('../usage-stats-service')

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', status: 'complete', content: [{ type: 'text', text: 'hi' }], createdAt: '2026-05-11T00:00:00Z', providerId: 'claude' },
      { id: 'a1', role: 'assistant', status: 'complete', content: [{ type: 'text', text: 'hello' }], createdAt: '2026-05-11T00:00:01Z', providerId: 'claude' },
    ]
    const input = { sid: 's-dup', projectPath: '/tmp/proj', providerId: 'claude-base', messages, totalCostUsd: 0, contextTokens: 0 }
    saveSessionStateBySid(input)
    saveSessionStateBySid(input)

    expect(queryCounts({})).toEqual({ sessions: 1, messages: 2 })
  })

  it('counts only newly appended messages on follow-up save', async () => {
    const { saveSessionStateBySid } = await import('./session-repo')
    const { queryCounts } = await import('../usage-stats-service')

    const first: ChatMessage[] = [
      { id: 'u1', role: 'user', status: 'complete', content: [{ type: 'text', text: 'hi' }], createdAt: '2026-05-11T00:00:00Z', providerId: 'claude' },
      { id: 'a1', role: 'assistant', status: 'complete', content: [{ type: 'text', text: 'hello' }], createdAt: '2026-05-11T00:00:01Z', providerId: 'claude' },
    ]
    saveSessionStateBySid({ sid: 's-inc', projectPath: '/tmp/proj', providerId: 'claude-base', messages: first, totalCostUsd: 0, contextTokens: 0 })

    const second: ChatMessage[] = [
      ...first,
      { id: 'u2', role: 'user', status: 'complete', content: [{ type: 'text', text: 'again' }], createdAt: '2026-05-11T00:01:00Z', providerId: 'claude' },
      { id: 'a2', role: 'assistant', status: 'complete', content: [{ type: 'text', text: 'sure' }], createdAt: '2026-05-11T00:01:01Z', providerId: 'claude' },
    ]
    saveSessionStateBySid({ sid: 's-inc', projectPath: '/tmp/proj', providerId: 'claude-base', messages: second, totalCostUsd: 0, contextTokens: 0 })

    expect(queryCounts({})).toEqual({ sessions: 1, messages: 4 })
  })

  it('skips streaming assistant messages (counts them only when complete)', async () => {
    const { saveSessionStateBySid } = await import('./session-repo')
    const { queryCounts } = await import('../usage-stats-service')

    const streaming: ChatMessage[] = [
      { id: 'u1', role: 'user', status: 'complete', content: [{ type: 'text', text: 'hi' }], createdAt: '2026-05-11T00:00:00Z', providerId: 'claude' },
      { id: 'a1', role: 'assistant', status: 'streaming', content: [{ type: 'text', text: '...' }], createdAt: '2026-05-11T00:00:01Z', providerId: 'claude' },
    ]
    saveSessionStateBySid({ sid: 's-stream', projectPath: '/tmp/proj', providerId: 'claude-base', messages: streaming, totalCostUsd: 0, contextTokens: 0 })
    expect(queryCounts({})).toEqual({ sessions: 1, messages: 1 })

    const completed: ChatMessage[] = [
      streaming[0],
      { ...streaming[1], status: 'complete' },
    ]
    saveSessionStateBySid({ sid: 's-stream', projectPath: '/tmp/proj', providerId: 'claude-base', messages: completed, totalCostUsd: 0, contextTokens: 0 })
    expect(queryCounts({})).toEqual({ sessions: 1, messages: 2 })
  })

  it('does not throw when activity_daily write fails after messages commit', async () => {
    const { saveSessionStateBySid } = await import('./session-repo')
    const origPrepare = fake.db.prepare
    fake.db.prepare = (rawSql: string) => {
      const sql = rawSql.replace(/\s+/g, ' ').trim()
      if (/^INSERT INTO activity_daily/.test(sql)) {
        return {
          run: () => {
            throw new Error('stats down')
          },
        }
      }
      return origPrepare(rawSql)
    }

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', status: 'complete', content: [{ type: 'text', text: 'hi' }], createdAt: '2026-05-11T00:00:00Z', providerId: 'claude' },
    ]
    expect(() => saveSessionStateBySid({
      sid: 's-stats-fail',
      projectPath: '/tmp/proj',
      providerId: 'claude-base',
      messages,
      totalCostUsd: 0,
      contextTokens: 0,
    })).not.toThrow()
    expect(fake.messages.get('u1')).toBeDefined()
    fake.db.prepare = origPrepare
  })

  it('attributes harness=codex when providerId starts with codex', async () => {
    const { saveSessionStateBySid } = await import('./session-repo')
    const { queryCounts } = await import('../usage-stats-service')

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', status: 'complete', content: [{ type: 'text', text: 'hi' }], createdAt: '2026-05-11T00:00:00Z', providerId: 'codex' },
    ]
    saveSessionStateBySid({ sid: 's-codex', projectPath: '/tmp/proj', providerId: 'codex-base', messages, totalCostUsd: 0, contextTokens: 0 })

    expect(queryCounts({ harness: 'codex' })).toEqual({ sessions: 1, messages: 1 })
    expect(queryCounts({ harness: 'claude' })).toEqual({ sessions: 0, messages: 0 })
  })
})
