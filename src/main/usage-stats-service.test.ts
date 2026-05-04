import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexUsageInfo, MessageMetadata } from '../shared/agent-types'

interface DailyKey { day: string; harness: string; model: string }
interface DailyVal extends DailyKey {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
}

interface ActivityKey { day: string; harness: string }
interface ActivityVal extends ActivityKey {
  sessions_started: number
  user_messages: number
  assistant_messages: number
}

interface ChatMessageRow {
  id: string
  session_id: string
  metadata_json: string | null
  created_at: string
  provider_id: string
  role: string
  status: string
  usage_counted_at: string | null
}

interface SessionRow {
  id: string
  created_at: string
  provider: string
  usage_counted_at: string | null
}

const state = {
  daily: new Map<string, DailyVal>(),
  activity: new Map<string, ActivityVal>(),
  meta: new Map<string, string>(),
  messages: [] as ChatMessageRow[],
  sessions: [] as SessionRow[],
}

function dailyKey(d: string, h: string, m: string): string {
  return `${d}::${h}::${m}`
}
function activityKey(d: string, h: string): string {
  return `${d}::${h}`
}

function rangeFilterParams(sql: string, args: unknown[]): { from?: string; to?: string; harness?: string } {
  const result: { from?: string; to?: string; harness?: string } = {}
  let i = 0
  if (sql.includes('day >=')) result.from = args[i++] as string
  if (sql.includes('day <=')) result.to = args[i++] as string
  if (sql.includes('harness =')) result.harness = args[i] as string
  return result
}

function fakeDb(): {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => { changes: number }
    all: (...args: unknown[]) => unknown[]
    get: (...args: unknown[]) => unknown
    iterate: () => Iterable<unknown>
  }
  exec: (sql: string) => void
  transaction: <T>(fn: () => T) => () => T
} {
  return {
    prepare: (sql: string) => {
      const trimmed = sql.replace(/\s+/g, ' ').trim()
      if (trimmed.startsWith('INSERT INTO usage_daily')) {
        return {
          run: (...args: unknown[]) => {
            const [day, harness, model, input, output, cr, cc] = args as [string, string, string, number, number, number, number]
            const key = dailyKey(day, harness, model)
            const existing = state.daily.get(key)
            if (existing) {
              existing.input_tokens += input
              existing.output_tokens += output
              existing.cache_read_tokens += cr
              existing.cache_creation_tokens += cc
            } else {
              state.daily.set(key, { day, harness, model, input_tokens: input, output_tokens: output, cache_read_tokens: cr, cache_creation_tokens: cc })
            }
            return { changes: 1 }
          },
          all: () => [],
          get: () => undefined,
          iterate: () => [],
        }
      }
      if (trimmed.startsWith('INSERT INTO activity_daily')) {
        return {
          run: (...args: unknown[]) => {
            const [day, harness, s, u, a] = args as [string, string, number, number, number]
            const key = activityKey(day, harness)
            const existing = state.activity.get(key)
            if (existing) {
              existing.sessions_started += s
              existing.user_messages += u
              existing.assistant_messages += a
            } else {
              state.activity.set(key, { day, harness, sessions_started: s, user_messages: u, assistant_messages: a })
            }
            return { changes: 1 }
          },
          all: () => [],
          get: () => undefined,
          iterate: () => [],
        }
      }
      if (trimmed.startsWith('SELECT day, harness, model')) {
        return {
          run: () => ({ changes: 0 }),
          all: (...args: unknown[]) => {
            const filt = rangeFilterParams(trimmed, args)
            const all = Array.from(state.daily.values())
              .filter((r) => filt.from ? r.day >= filt.from : true)
              .filter((r) => filt.to ? r.day <= filt.to : true)
            return all.sort((a, b) => b.day.localeCompare(a.day) || a.harness.localeCompare(b.harness) || a.model.localeCompare(b.model))
          },
          get: () => undefined,
          iterate: () => [],
        }
      }
      if (trimmed.startsWith('SELECT COALESCE(SUM(sessions_started)')) {
        return {
          run: () => ({ changes: 0 }),
          all: () => [],
          get: (...args: unknown[]) => {
            const filt = rangeFilterParams(trimmed, args)
            let sessions = 0
            let messages = 0
            for (const r of state.activity.values()) {
              if (filt.from && r.day < filt.from) continue
              if (filt.to && r.day > filt.to) continue
              if (filt.harness && r.harness !== filt.harness) continue
              sessions += r.sessions_started
              messages += r.user_messages + r.assistant_messages
            }
            return { sessions, messages }
          },
          iterate: () => [],
        }
      }
      if (trimmed.startsWith('SELECT value FROM app_meta')) {
        return {
          run: () => ({ changes: 0 }),
          all: () => [],
          get: (key: string) => state.meta.has(key) ? { value: state.meta.get(key) } : undefined,
          iterate: () => [],
        }
      }
      if (trimmed.startsWith('INSERT INTO app_meta')) {
        return {
          run: (key: string, value: string) => {
            state.meta.set(key, value)
            return { changes: 1 }
          },
          all: () => [],
          get: () => undefined,
          iterate: () => [],
        }
      }
      if (trimmed.startsWith('SELECT id, created_at, COALESCE(NULLIF(provider')) {
        return {
          run: () => ({ changes: 0 }),
          all: () => state.sessions.map((s) => ({ id: s.id, created_at: s.created_at, provider: s.provider || 'claude' })),
          get: () => undefined,
          iterate: () => [],
        }
      }
      if (trimmed.startsWith('SELECT id, session_id, metadata_json, created_at, provider_id, role, status FROM chat_messages')) {
        return {
          run: () => ({ changes: 0 }),
          all: () => state.messages,
          get: () => undefined,
          iterate: () => [],
        }
      }
      if (trimmed.startsWith('UPDATE sessions SET usage_counted_at')) {
        return {
          run: (now: string, id: string) => {
            const s = state.sessions.find((x) => x.id === id)
            if (s) s.usage_counted_at = now
            return { changes: s ? 1 : 0 }
          },
          all: () => [],
          get: () => undefined,
          iterate: () => [],
        }
      }
      if (trimmed.startsWith('UPDATE chat_messages SET usage_counted_at')) {
        return {
          run: (now: string, id: string) => {
            const m = state.messages.find((x) => x.id === id)
            if (m) m.usage_counted_at = now
            return { changes: m ? 1 : 0 }
          },
          all: () => [],
          get: () => undefined,
          iterate: () => [],
        }
      }
      return {
        run: () => ({ changes: 0 }),
        all: () => [],
        get: () => undefined,
        iterate: () => [],
      }
    },
    exec: (sql: string) => {
      const trimmed = sql.replace(/\s+/g, ' ').trim()
      if (trimmed.startsWith('DELETE FROM usage_daily')) state.daily.clear()
      else if (trimmed.startsWith('DELETE FROM activity_daily')) state.activity.clear()
    },
    transaction: <T>(fn: () => T) => () => fn(),
  }
}

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('./database', () => ({ getDb: getDbMock }))

beforeEach(() => {
  state.daily.clear()
  state.activity.clear()
  state.meta.clear()
  state.messages.length = 0
  state.sessions.length = 0
  getDbMock.mockReturnValue(fakeDb())
})

function makeClaudeMetadata(scale = 1): MessageMetadata {
  return {
    costUsd: 0.05 * scale,
    modelUsage: {
      'claude-sonnet-4-6': {
        inputTokens: 100 * scale,
        outputTokens: 200 * scale,
        cacheReadInputTokens: 50 * scale,
        cacheCreationInputTokens: 25 * scale,
        costUSD: 0.05 * scale,
      },
    },
  }
}

function makeCodexUsage(input = 80, output = 150, cached = 20): CodexUsageInfo {
  return {
    totalInputTokens: input,
    totalCachedInputTokens: cached,
    totalOutputTokens: output,
    lastInputTokens: input,
    lastCachedInputTokens: cached,
    lastOutputTokens: output,
    reasoningOutputTokens: 0,
    contextWindow: 200000,
  }
}

describe('usage-stats-service: localDay', () => {
  it('formats local-time date as YYYY-MM-DD', async () => {
    const { localDay } = await import('./usage-stats-service')
    expect(localDay(new Date(2026, 4, 4, 10, 30))).toBe('2026-05-04')
  })

  it('returns empty string for invalid input', async () => {
    const { localDay } = await import('./usage-stats-service')
    expect(localDay('not a date')).toBe('')
  })
})

describe('usage-stats-service: codexUsageStepDelta', () => {
  it('subtracts cached input from total to derive billable input', async () => {
    const { codexUsageStepDelta } = await import('./usage-stats-service')
    const delta = codexUsageStepDelta(makeCodexUsage(100, 200, 30))
    expect(delta).toEqual({ inputTokens: 70, outputTokens: 200, cacheReadTokens: 30, cacheCreationTokens: 0 })
  })

  it('clamps negative input to zero when cached exceeds raw input', async () => {
    const { codexUsageStepDelta } = await import('./usage-stats-service')
    expect(codexUsageStepDelta(makeCodexUsage(20, 100, 50)).inputTokens).toBe(0)
  })
})

describe('usage-stats-service: subtractDelta', () => {
  it('clamps to zero on underflow (snapshot reset across queries)', async () => {
    const { subtractDelta } = await import('./usage-stats-service')
    const result = subtractDelta(
      { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 },
    )
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })
  })

  it('subtracts each token field', async () => {
    const { subtractDelta } = await import('./usage-stats-service')
    expect(subtractDelta(
      { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheCreationTokens: 3 },
      { inputTokens: 4, outputTokens: 7, cacheReadTokens: 2, cacheCreationTokens: 1 },
    )).toEqual({ inputTokens: 6, outputTokens: 13, cacheReadTokens: 3, cacheCreationTokens: 2 })
  })
})

describe('usage-stats-service: recordClaudeStepDeltas', () => {
  it('writes per-model delta into usage_daily', async () => {
    const { recordClaudeStepDeltas, queryUsage } = await import('./usage-stats-service')
    recordClaudeStepDeltas({ 'claude-sonnet-4-6': { inputTokens: 100, outputTokens: 200, cacheReadTokens: 50, cacheCreationTokens: 25 } }, new Date(2026, 4, 4, 10))
    const { rows } = queryUsage()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ harness: 'claude', model: 'claude-sonnet-4-6', input_tokens: 100, output_tokens: 200, cache_read_tokens: 50, cache_creation_tokens: 25 })
  })

  it('accumulates two deltas on the same day into one row', async () => {
    const { recordClaudeStepDeltas, queryUsage } = await import('./usage-stats-service')
    const day = new Date(2026, 4, 4, 10)
    recordClaudeStepDeltas({ 'claude-sonnet-4-6': { inputTokens: 100, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0 } }, day)
    recordClaudeStepDeltas({ 'claude-sonnet-4-6': { inputTokens: 50, outputTokens: 30, cacheReadTokens: 0, cacheCreationTokens: 0 } }, day)
    const { rows } = queryUsage()
    expect(rows).toHaveLength(1)
    expect(rows[0].input_tokens).toBe(150)
    expect(rows[0].output_tokens).toBe(230)
  })

  it('does not write rows when delta is all zeros', async () => {
    const { recordClaudeStepDeltas, queryUsage } = await import('./usage-stats-service')
    recordClaudeStepDeltas({ x: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } }, new Date(2026, 4, 4, 10))
    expect(queryUsage().rows).toHaveLength(0)
  })

  it('keeps separate rows per model', async () => {
    const { recordClaudeStepDeltas, queryUsage } = await import('./usage-stats-service')
    recordClaudeStepDeltas({
      'claude-sonnet-4-6': { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 },
      'claude-haiku-4-5': { inputTokens: 5, outputTokens: 6, cacheReadTokens: 0, cacheCreationTokens: 0 },
    }, new Date(2026, 4, 4, 10))
    expect(queryUsage().rows.map((r) => r.model).sort()).toEqual(['claude-haiku-4-5', 'claude-sonnet-4-6'])
  })

  it('respects local-day boundary (different days → different rows)', async () => {
    const { recordClaudeStepDeltas, queryUsage } = await import('./usage-stats-service')
    recordClaudeStepDeltas({ x: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 } }, new Date(2026, 4, 4, 10))
    recordClaudeStepDeltas({ x: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 } }, new Date(2026, 4, 5, 10))
    expect(queryUsage().rows.map((r) => r.day).sort()).toEqual(['2026-05-04', '2026-05-05'])
  })
})

describe('usage-stats-service: recordCodexFromUsage', () => {
  it('records codex usage with provided model name', async () => {
    const { recordCodexFromUsage, queryUsage } = await import('./usage-stats-service')
    recordCodexFromUsage(makeCodexUsage(80, 150, 20), 'gpt-5-codex', new Date(2026, 4, 4, 10))
    expect(queryUsage().rows[0]).toMatchObject({ harness: 'codex', model: 'gpt-5-codex', input_tokens: 60, output_tokens: 150, cache_read_tokens: 20 })
  })

  it('falls back to model="codex" when undefined', async () => {
    const { recordCodexFromUsage, queryUsage } = await import('./usage-stats-service')
    recordCodexFromUsage(makeCodexUsage(), undefined, new Date(2026, 4, 4, 10))
    expect(queryUsage().rows[0].model).toBe('codex')
  })
})

describe('usage-stats-service: activity counts', () => {
  it('records sessions_started and message counts independently', async () => {
    const { recordSessionStarted, recordMessageCounts, queryCounts } = await import('./usage-stats-service')
    const day = new Date(2026, 4, 4, 10)
    recordSessionStarted('claude', day)
    recordSessionStarted('claude', day)
    recordMessageCounts('claude', day, { userMessages: 3, assistantMessages: 2 })
    expect(queryCounts()).toEqual({ sessions: 2, messages: 5 })
  })

  it('filters counts by harness', async () => {
    const { recordSessionStarted, recordMessageCounts, queryCounts } = await import('./usage-stats-service')
    const day = new Date(2026, 4, 4, 10)
    recordSessionStarted('claude', day)
    recordSessionStarted('codex', day)
    recordMessageCounts('claude', day, { userMessages: 1, assistantMessages: 1 })
    recordMessageCounts('codex', day, { userMessages: 4, assistantMessages: 4 })
    expect(queryCounts({ harness: 'claude' })).toEqual({ sessions: 1, messages: 2 })
    expect(queryCounts({ harness: 'codex' })).toEqual({ sessions: 1, messages: 8 })
  })

  it('respects from/to range filter', async () => {
    const { recordSessionStarted, recordMessageCounts, queryCounts } = await import('./usage-stats-service')
    recordSessionStarted('claude', new Date(2026, 4, 4, 10))
    recordSessionStarted('claude', new Date(2026, 4, 6, 10))
    recordMessageCounts('claude', new Date(2026, 4, 4, 10), { userMessages: 1 })
    recordMessageCounts('claude', new Date(2026, 4, 6, 10), { assistantMessages: 1 })
    const result = queryCounts({ from: '2026-05-05', to: '2026-05-07' })
    expect(result).toEqual({ sessions: 1, messages: 1 })
  })
})

describe('usage-stats-service: backfill', () => {
  it('starts in pending status and flips to done after backfill', async () => {
    const { getBackfillStatus, backfillFromHistory } = await import('./usage-stats-service')
    expect(getBackfillStatus()).toBe('pending')
    backfillFromHistory()
    expect(getBackfillStatus()).toBe('done')
  })

  it('counts sessions from sessions table on backfill', async () => {
    state.sessions.push(
      { id: 's1', created_at: new Date(2026, 4, 4, 10).toISOString(), provider: 'claude', usage_counted_at: null },
      { id: 's2', created_at: new Date(2026, 4, 4, 12).toISOString(), provider: 'claude', usage_counted_at: null },
      { id: 's3', created_at: new Date(2026, 4, 5, 9).toISOString(), provider: 'codex', usage_counted_at: null },
    )
    const { backfillFromHistory, queryCounts } = await import('./usage-stats-service')
    const summary = backfillFromHistory()
    expect(summary.sessionsRecorded).toBe(3)
    expect(queryCounts()).toMatchObject({ sessions: 3 })
    expect(queryCounts({ harness: 'codex' })).toMatchObject({ sessions: 1 })
  })

  it('counts user + complete assistant messages from chat_messages', async () => {
    state.sessions.push({ id: 's1', created_at: new Date(2026, 4, 4, 10).toISOString(), provider: 'claude', usage_counted_at: null })
    state.messages.push(
      { id: 'u1', session_id: 's1', metadata_json: null, created_at: new Date(2026, 4, 4, 10).toISOString(), provider_id: 'claude', role: 'user', status: 'complete', usage_counted_at: null },
      { id: 'a1', session_id: 's1', metadata_json: JSON.stringify(makeClaudeMetadata()), created_at: new Date(2026, 4, 4, 10).toISOString(), provider_id: 'claude', role: 'assistant', status: 'complete', usage_counted_at: null },
      { id: 'a2', session_id: 's1', metadata_json: null, created_at: new Date(2026, 4, 4, 10).toISOString(), provider_id: 'claude', role: 'assistant', status: 'streaming', usage_counted_at: null },
    )
    const { backfillFromHistory, queryCounts } = await import('./usage-stats-service')
    backfillFromHistory()
    expect(queryCounts()).toEqual({ sessions: 1, messages: 2 })
  })

  it('takes per-session per-model max for Claude (avoids cumulative double-count)', async () => {
    state.sessions.push({ id: 's1', created_at: new Date(2026, 4, 4, 10).toISOString(), provider: 'claude', usage_counted_at: null })
    state.messages.push(
      { id: 'a1', session_id: 's1', metadata_json: JSON.stringify(makeClaudeMetadata(1)), created_at: new Date(2026, 4, 4, 10).toISOString(), provider_id: 'claude', role: 'assistant', status: 'complete', usage_counted_at: null },
      { id: 'a2', session_id: 's1', metadata_json: JSON.stringify(makeClaudeMetadata(2)), created_at: new Date(2026, 4, 4, 11).toISOString(), provider_id: 'claude', role: 'assistant', status: 'complete', usage_counted_at: null },
      { id: 'a3', session_id: 's1', metadata_json: JSON.stringify(makeClaudeMetadata(3)), created_at: new Date(2026, 4, 4, 12).toISOString(), provider_id: 'claude', role: 'assistant', status: 'complete', usage_counted_at: null },
    )
    const { backfillFromHistory, queryUsage } = await import('./usage-stats-service')
    backfillFromHistory()
    const claudeRow = queryUsage().rows.find((r) => r.harness === 'claude')!
    expect(claudeRow.input_tokens).toBe(300)
    expect(claudeRow.output_tokens).toBe(600)
  })

  it('aggregates Codex usage as sum-of-step (already per-step in metadata)', async () => {
    state.sessions.push({ id: 's1', created_at: new Date(2026, 4, 4, 10).toISOString(), provider: 'codex', usage_counted_at: null })
    state.messages.push(
      { id: 'c1', session_id: 's1', metadata_json: JSON.stringify({ codex: { threadId: 't1', usage: makeCodexUsage(80, 150, 20), items: [], model: 'gpt-5-codex' } }), created_at: new Date(2026, 4, 4, 10).toISOString(), provider_id: 'codex', role: 'assistant', status: 'complete', usage_counted_at: null },
      { id: 'c2', session_id: 's1', metadata_json: JSON.stringify({ codex: { threadId: 't1', usage: makeCodexUsage(40, 80, 10), items: [], model: 'gpt-5-codex' } }), created_at: new Date(2026, 4, 4, 11).toISOString(), provider_id: 'codex', role: 'assistant', status: 'complete', usage_counted_at: null },
    )
    const { backfillFromHistory, queryUsage } = await import('./usage-stats-service')
    backfillFromHistory()
    const codexRow = queryUsage().rows.find((r) => r.harness === 'codex')!
    expect(codexRow.input_tokens).toBe((80 - 20) + (40 - 10))
    expect(codexRow.output_tokens).toBe(150 + 80)
  })

  it('marks usage_counted_at on backfilled session and message rows', async () => {
    state.sessions.push({ id: 's1', created_at: new Date(2026, 4, 4, 10).toISOString(), provider: 'claude', usage_counted_at: null })
    state.messages.push({ id: 'a1', session_id: 's1', metadata_json: JSON.stringify(makeClaudeMetadata()), created_at: new Date(2026, 4, 4, 10).toISOString(), provider_id: 'claude', role: 'assistant', status: 'complete', usage_counted_at: null })
    const { backfillFromHistory } = await import('./usage-stats-service')
    backfillFromHistory()
    expect(state.sessions[0].usage_counted_at).not.toBeNull()
    expect(state.messages[0].usage_counted_at).not.toBeNull()
  })
})
