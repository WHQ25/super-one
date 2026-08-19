import { describe, expect, it } from 'vitest'
import type { TrajectoryProjection, TrajectoryRecord } from '@superone/shared/trajectory-types'
import { buildLedgerRows, stepKey } from './trajectory-rows'

/** A user record opening turn `turn`. */
function user(index: number, turn: number | null, summary: string): TrajectoryRecord {
  return {
    id: `user:${index}`,
    index,
    kind: 'user',
    seq: index,
    turn,
    step: null,
    request: null,
    startedAt: 1_000 + index,
    durationMs: null,
    summary,
    content: { text: summary },
    blocks: [],
  }
}

/** A model message in `turn`/`step`. */
function message(index: number, turn: number, step: number, summary: string): TrajectoryRecord {
  return {
    id: `message:${index}`,
    index,
    kind: 'message',
    seq: index,
    turn,
    step,
    request: 1,
    startedAt: 1_000 + index,
    durationMs: 10,
    summary,
    text: { text: summary },
    thinking: null,
    blocks: [],
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: null,
    ttftMs: null,
  }
}

/** A tool call in `turn`/`step`. */
function tool(index: number, turn: number, step: number, name: string): TrajectoryRecord {
  return {
    id: `tool:${index}`,
    index,
    kind: 'tool',
    seq: index,
    turn,
    step,
    request: 1,
    startedAt: 1_000 + index,
    durationMs: 5,
    summary: `${name} {}`,
    name,
    callId: `call-${index}`,
    args: { text: '{}' },
    result: { text: 'ok' },
    schema: null,
    isError: false,
    error: null,
  }
}

/** A compaction between turns. */
function compaction(index: number): TrajectoryRecord {
  return {
    id: `compacted:${index}`,
    index,
    kind: 'compacted',
    seq: index,
    turn: null,
    step: null,
    request: 2,
    startedAt: 1_000 + index,
    durationMs: 50,
    summary: 'compaction (manual)',
    trigger: 'manual',
    preTokens: 8_000,
    postTokens: 120,
    compactionSummary: null,
  }
}

function projection(records: TrajectoryRecord[]): TrajectoryProjection {
  return {
    sessionId: 's1',
    headers: [],
    records,
    requests: [],
    turns: [
      { turn: 1, startedAt: 1_000, durationMs: 100, outcome: 'completed', steps: 1, toolCalls: 1 },
      { turn: 2, startedAt: 2_000, durationMs: 100, outcome: 'completed', steps: 1, toolCalls: 0 },
    ],
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    firstIndex: 1,
    total: records.length,
    cursor: records.length,
    live: false,
  }
}

const RECORDS = [
  user(1, 1, 'fix the build'),
  message(2, 1, 1, 'inspecting the config'),
  tool(3, 1, 1, 'read'),
  compaction(4),
  user(5, 2, 'now run the tests'),
  message(6, 2, 1, 'running them'),
]

const NONE: ReadonlySet<never> = new Set()

describe('buildLedgerRows', () => {
  it('opens a header for each turn and for the records that belong to none', () => {
    const rows = buildLedgerRows({
      projection: projection(RECORDS),
      query: '',
      visibleIds: null,
      foldedTurns: NONE,
      foldedSteps: NONE,
    })

    expect(rows.map((row) => row.kind)).toEqual([
      'turn', 'record', 'record', 'record',
      'between', 'record',
      'turn', 'record', 'record',
    ])
  })

  it('keeps a folded turn visible while hiding its records', () => {
    const rows = buildLedgerRows({
      projection: projection(RECORDS),
      query: '',
      visibleIds: null,
      foldedTurns: new Set([1]),
      foldedSteps: NONE,
    })

    const turnOne = rows.find((row) => row.kind === 'turn' && row.turn.turn === 1)
    expect(turnOne).toMatchObject({ folded: true })
    expect(rows.some((row) => row.kind === 'record' && row.record.turn === 1)).toBe(false)
    // Turn 2 is untouched — folding is per turn, not a global switch.
    expect(rows.some((row) => row.kind === 'record' && row.record.turn === 2)).toBe(true)
  })

  it('folds a step down to the message that requested its calls', () => {
    const rows = buildLedgerRows({
      projection: projection(RECORDS),
      query: '',
      visibleIds: null,
      foldedTurns: NONE,
      foldedSteps: new Set([stepKey(1, 1)]),
    })

    const kinds = rows.filter((row) => row.kind === 'record').map((row) => row.record.kind)
    expect(kinds).toContain('message')
    expect(kinds).not.toContain('tool')
  })

  it('reveals matches inside a folded turn rather than hiding them', () => {
    const rows = buildLedgerRows({
      projection: projection(RECORDS),
      query: 'read',
      visibleIds: null,
      // Both fold sets would hide the matching tool record; a search that
      // silently returns nothing would be worse than one that expands.
      foldedTurns: new Set([1, 2]),
      foldedSteps: new Set([stepKey(1, 1)]),
    })

    expect(rows.filter((row) => row.kind === 'record').map((row) => row.record.id)).toEqual(['tool:3'])
  })

  it('opens a boundary row where each model call begins', () => {
    const window = projection(RECORDS)
    window.requests = [
      { ordinal: 1, seq: 2, purpose: 'generation', turn: 1, step: 1, startedAt: 1_000, durationMs: 900, ttftMs: 200, usage: null, route: null, header: null },
    ]
    const rows = buildLedgerRows({
      projection: window,
      query: '',
      visibleIds: null,
      foldedTurns: NONE,
      foldedSteps: NONE,
    })

    // The boundary precedes the first record that belongs to the call, so a
    // user reads "this call, then what it produced".
    const positions = rows.map((row) => row.kind)
    expect(positions).toContain('request')
    expect(positions.indexOf('request')).toBeLessThan(
      rows.findIndex((row) => row.kind === 'record' && row.record.kind === 'message'),
    )
  })

  it('offers an interactive head row only while earlier history exists', () => {
    const reachesStart = buildLedgerRows({
      projection: projection(RECORDS),
      query: '',
      visibleIds: null,
      foldedTurns: NONE,
      foldedSteps: NONE,
    })
    expect(reachesStart.some((row) => row.kind === 'earlier')).toBe(false)

    const partial = projection(RECORDS)
    partial.firstIndex = 40
    partial.total = 45
    const rows = buildLedgerRows({
      projection: partial,
      query: '',
      visibleIds: null,
      foldedTurns: NONE,
      foldedSteps: NONE,
    })
    expect(rows[0]?.kind).toBe('earlier')
  })

  it('narrows the ledger to the ids a timeline selection admits', () => {
    const rows = buildLedgerRows({
      projection: projection(RECORDS),
      query: '',
      visibleIds: new Set(['tool:3']),
      foldedTurns: NONE,
      foldedSteps: NONE,
    })

    expect(rows.filter((row) => row.kind === 'record').map((row) => row.record.id)).toEqual(['tool:3'])
  })

  it('matches a tool by name and a message by model without reading payloads', () => {
    const byModel = buildLedgerRows({
      projection: projection(RECORDS),
      query: 'deepseek-chat',
      visibleIds: null,
      foldedTurns: NONE,
      foldedSteps: NONE,
    })
    expect(byModel.filter((row) => row.kind === 'record')).toHaveLength(2)

    const byNothing = buildLedgerRows({
      projection: projection(RECORDS),
      query: 'no such thing',
      visibleIds: null,
      foldedTurns: NONE,
      foldedSteps: NONE,
    })
    expect(byNothing).toHaveLength(0)
  })
})
