import { describe, expect, it } from 'vitest'
import type {
  TrajectoryDelta,
  TrajectoryProjection,
  TrajectoryRecord,
} from '@superone/shared/trajectory-types'
import { mergeDelta, prependPage } from './use-trajectory'

/** A tool record at one ledger position, optionally already completed. */
function tool(index: number, result: string | null): TrajectoryRecord {
  return {
    id: `tool:${index}`,
    index,
    kind: 'tool',
    seq: index,
    turn: 1,
    step: 1,
    request: 1,
    startedAt: 1_000 + index,
    durationMs: result === null ? null : 400,
    summary: `read ${index}`,
    name: 'read',
    callId: `call-${index}`,
    args: { text: '{}' },
    result: result === null ? null : { text: result },
    schema: null,
    isError: false,
    error: null,
  }
}

/** A loaded window starting at `firstIndex`. */
function windowOf(records: TrajectoryRecord[], firstIndex: number, total: number): TrajectoryProjection {
  return {
    sessionId: 's1',
    headers: [],
    records,
    requests: [],
    turns: [{ turn: 1, startedAt: 1_000, durationMs: null, outcome: null, steps: 1, toolCalls: records.length }],
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    firstIndex,
    total,
    cursor: 10,
    live: true,
  }
}

/** A delta carrying `records`, with everything else unchanged. */
function delta(records: TrajectoryRecord[], total: number): TrajectoryDelta {
  return {
    cursor: 20,
    records,
    headers: [],
    requests: [],
    turns: [],
    totals: { input: 5, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    total,
    live: true,
  }
}

describe('mergeDelta', () => {
  it('revises a record in place and appends a new one', () => {
    const current = windowOf([tool(1, null), tool(2, null)], 1, 2)
    const next = mergeDelta(current, delta([tool(1, 'done'), tool(3, null)], 3))

    expect(next.records.map((record) => record.index)).toEqual([1, 2, 3])
    const revised = next.records[0]
    expect(revised?.kind === 'tool' && revised.result?.text).toBe('done')
    expect(next.total).toBe(3)
    expect(next.cursor).toBe(20)
  })

  it('drops a revision to a record older than the loaded window', () => {
    // The window starts at 5; record 2 belongs to a page that has not been
    // fetched. Merging it by position would overwrite an unrelated record.
    const current = windowOf([tool(5, null), tool(6, null)], 5, 6)
    const next = mergeDelta(current, delta([tool(2, 'done')], 6))

    expect(next.records.map((record) => record.index)).toEqual([5, 6])
  })

  it('refuses a record that would land past the end of the window', () => {
    // Index 4 is one beyond the window's last record. Writing it by position
    // would leave a hole at index 3 that the ledger would then read as a row.
    const current = windowOf([tool(1, null), tool(2, null)], 1, 2)
    const next = mergeDelta(current, delta([tool(4, null)], 4))

    expect(next.records.map((record) => record.index)).toEqual([1, 2])
    expect(next.records.every(Boolean)).toBe(true)
  })

  it('returns the same window when nothing landed', () => {
    const current = windowOf([tool(1, 'done')], 1, 1)
    const unchanged = mergeDelta(current, { ...delta([], 1), cursor: current.cursor })

    expect(unchanged).toBe(current)
  })
})

describe('prependPage', () => {
  it('extends the window backwards and moves its first index', () => {
    const current = windowOf([tool(5, null)], 5, 5)
    const next = prependPage(current, [tool(3, 'a'), tool(4, 'b')], 3)

    expect(next.firstIndex).toBe(3)
    expect(next.records.map((record) => record.index)).toEqual([3, 4, 5])
  })

  it('leaves the window alone when the page is empty', () => {
    const current = windowOf([tool(1, null)], 1, 1)
    expect(prependPage(current, [], 1)).toBe(current)
  })
})
