import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexUsageInfo, MessageMetadata } from '../shared/agent-types'

interface DailyKey { day: string; harness: string; model: string }
interface DailyVal {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
}

interface ChatMessageRow {
  metadata_json: string | null
  created_at: string
  provider_id: string
  role: string
  status: string
}

const state = {
  daily: new Map<string, DailyVal & DailyKey>(),
  meta: new Map<string, string>(),
  messages: [] as ChatMessageRow[],
}

function dailyKey(d: string, h: string, m: string): string {
  return `${d}::${h}::${m}`
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
      if (trimmed.startsWith('SELECT day, harness, model')) {
        return {
          run: () => ({ changes: 0 }),
          all: (...args: unknown[]) => {
            const [from, to] = args as [string?, string?]
            const params = args.filter((a): a is string => typeof a === 'string')
            const fromVal = trimmed.includes('day >=') ? params[0] : undefined
            const toVal = trimmed.includes('day <=') ? params[trimmed.includes('day >=') ? 1 : 0] : undefined
            void from; void to
            const all = Array.from(state.daily.values())
              .filter((r) => fromVal ? r.day >= fromVal : true)
              .filter((r) => toVal ? r.day <= toVal : true)
            return all.sort((a, b) => b.day.localeCompare(a.day) || a.harness.localeCompare(b.harness) || a.model.localeCompare(b.model))
          },
          get: () => undefined,
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
      if (trimmed.startsWith('SELECT metadata_json, created_at, provider_id FROM chat_messages')) {
        return {
          run: () => ({ changes: 0 }),
          all: () => state.messages,
          get: () => undefined,
          iterate: function* () {
            for (const row of state.messages) yield row
          },
        }
      }
      return {
        run: () => ({ changes: 0 }),
        all: () => [],
        get: () => undefined,
        iterate: () => [],
      }
    },
    exec: () => undefined,
    transaction: <T>(fn: () => T) => () => fn(),
  }
}

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('./database', () => ({ getDb: getDbMock }))

beforeEach(() => {
  state.daily.clear()
  state.meta.clear()
  state.messages.length = 0
  getDbMock.mockReturnValue(fakeDb())
})

function makeClaudeMetadata(): MessageMetadata {
  return {
    costUsd: 0.05,
    usage: {
      inputTokens: 100,
      outputTokens: 200,
      cacheReadInputTokens: 50,
      cacheCreationInputTokens: 25,
    },
    modelUsage: {
      'claude-sonnet-4-6': {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadInputTokens: 50,
        cacheCreationInputTokens: 25,
        costUSD: 0.05,
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
    expect(delta).toEqual({
      inputTokens: 70,
      outputTokens: 200,
      cacheReadTokens: 30,
      cacheCreationTokens: 0,
    })
  })

  it('clamps negative input to zero when cached exceeds raw input', async () => {
    const { codexUsageStepDelta } = await import('./usage-stats-service')
    const delta = codexUsageStepDelta(makeCodexUsage(20, 100, 50))
    expect(delta.inputTokens).toBe(0)
  })
})

describe('usage-stats-service: record + query', () => {
  it('records Claude metadata into per-model daily buckets', async () => {
    const { recordClaudeFromMetadata, queryUsage } = await import('./usage-stats-service')
    recordClaudeFromMetadata(makeClaudeMetadata(), new Date(2026, 4, 4, 10))
    const { rows } = queryUsage()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      harness: 'claude',
      model: 'claude-sonnet-4-6',
      input_tokens: 100,
      output_tokens: 200,
      cache_read_tokens: 50,
      cache_creation_tokens: 25,
    })
  })

  it('accumulates multiple Claude turns into the same row on the same day', async () => {
    const { recordClaudeFromMetadata, queryUsage } = await import('./usage-stats-service')
    const day = new Date(2026, 4, 4, 10)
    recordClaudeFromMetadata(makeClaudeMetadata(), day)
    recordClaudeFromMetadata(makeClaudeMetadata(), day)
    const { rows } = queryUsage()
    expect(rows).toHaveLength(1)
    expect(rows[0].input_tokens).toBe(200)
    expect(rows[0].output_tokens).toBe(400)
  })

  it('keeps Claude rows for different models separate', async () => {
    const { recordClaudeFromMetadata, queryUsage } = await import('./usage-stats-service')
    const day = new Date(2026, 4, 4, 10)
    recordClaudeFromMetadata({
      modelUsage: {
        'claude-sonnet-4-6': { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
      },
    }, day)
    recordClaudeFromMetadata({
      modelUsage: {
        'claude-haiku-4-5': { inputTokens: 5, outputTokens: 6, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
      },
    }, day)
    const { rows } = queryUsage()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.model).sort()).toEqual(['claude-haiku-4-5', 'claude-sonnet-4-6'])
  })

  it('records Codex usage with provided model name', async () => {
    const { recordCodexFromUsage, queryUsage } = await import('./usage-stats-service')
    recordCodexFromUsage(makeCodexUsage(80, 150, 20), 'gpt-5-codex', new Date(2026, 4, 4, 10))
    const { rows } = queryUsage()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      harness: 'codex',
      model: 'gpt-5-codex',
      input_tokens: 60,
      output_tokens: 150,
      cache_read_tokens: 20,
      cache_creation_tokens: 0,
    })
  })

  it('falls back to model="codex" when not provided', async () => {
    const { recordCodexFromUsage, queryUsage } = await import('./usage-stats-service')
    recordCodexFromUsage(makeCodexUsage(), undefined, new Date(2026, 4, 4, 10))
    const { rows } = queryUsage()
    expect(rows[0].model).toBe('codex')
  })

  it('respects local-day boundary (different days → different rows)', async () => {
    const { recordClaudeFromMetadata, queryUsage } = await import('./usage-stats-service')
    recordClaudeFromMetadata(makeClaudeMetadata(), new Date(2026, 4, 4, 10))
    recordClaudeFromMetadata(makeClaudeMetadata(), new Date(2026, 4, 5, 10))
    const { rows } = queryUsage()
    expect(rows).toHaveLength(2)
    const days = rows.map((r) => r.day).sort()
    expect(days).toEqual(['2026-05-04', '2026-05-05'])
  })

  it('does not write when delta is all zeros', async () => {
    const { recordClaudeFromMetadata, queryUsage } = await import('./usage-stats-service')
    recordClaudeFromMetadata({
      modelUsage: {
        'claude-haiku-4-5': { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
      },
    }, new Date(2026, 4, 4, 10))
    const { rows } = queryUsage()
    expect(rows).toHaveLength(0)
  })

  it('falls back from modelUsage to flat usage with metadata.model', async () => {
    const { recordClaudeFromMetadata, queryUsage } = await import('./usage-stats-service')
    recordClaudeFromMetadata({
      model: 'claude-opus-4',
      usage: { inputTokens: 7, outputTokens: 8, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    }, new Date(2026, 4, 4, 10))
    const { rows } = queryUsage()
    expect(rows).toHaveLength(1)
    expect(rows[0].model).toBe('claude-opus-4')
    expect(rows[0].input_tokens).toBe(7)
  })
})

describe('usage-stats-service: backfill', () => {
  it('starts in pending status and flips to done after backfill', async () => {
    const { getBackfillStatus, backfillFromHistory } = await import('./usage-stats-service')
    expect(getBackfillStatus()).toBe('pending')
    backfillFromHistory()
    expect(getBackfillStatus()).toBe('done')
  })

  it('aggregates Claude + Codex assistant messages from chat_messages', async () => {
    const { backfillFromHistory, queryUsage } = await import('./usage-stats-service')

    const claudeMeta: MessageMetadata = {
      modelUsage: {
        'claude-sonnet-4-6': { inputTokens: 100, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.05 },
      },
    }
    const codexMeta: MessageMetadata = {
      codex: {
        threadId: 'thread-1',
        usage: makeCodexUsage(80, 150, 20),
        items: [],
        model: 'gpt-5-codex',
      },
    }
    state.messages.push(
      { metadata_json: JSON.stringify(claudeMeta), created_at: new Date(2026, 4, 4, 10).toISOString(), provider_id: 'claude', role: 'assistant', status: 'complete' },
      { metadata_json: JSON.stringify(codexMeta), created_at: new Date(2026, 4, 4, 11).toISOString(), provider_id: 'codex', role: 'assistant', status: 'complete' },
    )

    const summary = backfillFromHistory()
    expect(summary.scanned).toBe(2)
    expect(summary.claudeRecorded).toBe(1)
    expect(summary.codexRecorded).toBe(1)

    const { rows } = queryUsage()
    const claude = rows.find((r) => r.harness === 'claude')
    const codex = rows.find((r) => r.harness === 'codex')
    expect(claude?.model).toBe('claude-sonnet-4-6')
    expect(claude?.input_tokens).toBe(100)
    expect(codex?.model).toBe('gpt-5-codex')
    expect(codex?.input_tokens).toBe(60)
    expect(codex?.cache_read_tokens).toBe(20)
  })

  it('falls back to "codex" model name when metadata.codex.model is missing', async () => {
    const { backfillFromHistory, queryUsage } = await import('./usage-stats-service')
    const codexMeta: MessageMetadata = {
      codex: {
        threadId: 'thread-1',
        usage: makeCodexUsage(),
        items: [],
      },
    }
    state.messages.push({
      metadata_json: JSON.stringify(codexMeta),
      created_at: new Date(2026, 4, 4, 10).toISOString(),
      provider_id: 'codex',
      role: 'assistant',
      status: 'complete',
    })
    backfillFromHistory()
    const { rows } = queryUsage()
    expect(rows[0].model).toBe('codex')
  })

  it('skips messages with no usable usage metadata', async () => {
    const { backfillFromHistory, queryUsage } = await import('./usage-stats-service')
    state.messages.push(
      { metadata_json: JSON.stringify({ durationMs: 100 }), created_at: new Date(2026, 4, 4, 10).toISOString(), provider_id: 'claude', role: 'assistant', status: 'complete' },
      { metadata_json: 'not-json', created_at: new Date(2026, 4, 4, 10).toISOString(), provider_id: 'claude', role: 'assistant', status: 'complete' },
    )
    const summary = backfillFromHistory()
    expect(summary.scanned).toBe(2)
    expect(summary.claudeRecorded).toBe(0)
    expect(summary.codexRecorded).toBe(0)
    expect(queryUsage().rows).toHaveLength(0)
  })
})
