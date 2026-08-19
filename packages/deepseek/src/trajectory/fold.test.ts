import { describe, expect, it } from 'vitest'
import { TrajectoryFold } from './fold'
import { PAYLOAD_MAX_CHARS } from './payload'
import { HEADER, assistantMessage, log, toolResult } from './test-log'

/** A turn that opens a call, answers it, and closes — the shape a delta rides. */
const TURN = log([
  ['turn/start', { turn: 0 }, 1_000],
  ['request/header', { header: HEADER, reason: 'initial' }, 1_000],
  ['step/start', { turn: 0, step: 0 }, 1_000],
  ['assistant/message', { turn: 0, step: 0, message: assistantMessage('reading'), usage: { inputTokens: 10, outputTokens: 2 } }, 1_400],
  ['tool/call', { turn: 0, step: 0, callId: 'call-1', name: 'read', arguments: '{"path":"a.ts"}' }, 1_500],
  ['tool/result', toolResult('call-1', 'contents'), 1_900],
  ['step/end', { turn: 0, step: 0 }, 2_000],
  ['turn/end', { turn: 0, reason: { kind: 'completed' } }, 2_000],
])

describe('TrajectoryFold', () => {
  it('folds a log in batches to the same projection as folding it at once', () => {
    const whole = new TrajectoryFold('s1')
    whole.consume(TURN)

    const batched = new TrajectoryFold('s1')
    batched.consume(TURN.slice(0, 4))
    batched.consume(TURN.slice(4, 6))
    batched.consume(TURN.slice(6))

    expect(batched.snapshot(false)).toEqual(whole.snapshot(false))
  })

  it('reports records created and revised since a cursor, and nothing else', () => {
    const fold = new TrajectoryFold('s1')
    fold.consume(TURN.slice(0, 5))
    const cursor = fold.cursor

    fold.consume(TURN.slice(5))
    const delta = fold.delta(cursor, true)

    // The call was opened before the cursor but completed after it, so the
    // consumer must receive it again — in its final state, not as a patch.
    const tool = delta.records.find((record) => record.kind === 'tool')
    expect(tool?.kind === 'tool' && tool.result?.text).toBe('contents')
    // The message and header predate the cursor and did not change.
    expect(delta.records.map((record) => record.kind)).toEqual(['tool'])
    expect(delta.headers).toEqual([])
    expect(delta.total).toBe(fold.size)
  })

  it('answers each consumer from its own cursor rather than a drained queue', () => {
    const fold = new TrajectoryFold('s1')
    fold.consume(TURN.slice(0, 4))
    const shared = fold.cursor
    fold.consume(TURN.slice(4))

    const first = fold.delta(shared, false)
    const second = fold.delta(shared, false)

    // Two panels can watch one session; the first poll must not consume what
    // the second one has not seen yet.
    expect(second.records).toEqual(first.records)
    expect(second.records.length).toBeGreaterThan(0)
  })

  it('serves an earlier page from the same fold the window came from', () => {
    const fold = new TrajectoryFold('s1')
    fold.consume(log(Array.from({ length: 12 }, (_, index) => [
      'user/message',
      { id: `u${index}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `prompt ${index}` }] },
    ] as [string, unknown]) as Array<[never, unknown]>))

    const window = fold.snapshot(false, 4)
    expect(window.firstIndex).toBe(9)

    const page = fold.page(window.firstIndex, 5)
    expect(page.firstIndex).toBe(4)
    expect(page.records.map((record) => record.index)).toEqual([4, 5, 6, 7, 8])
  })

  it('retains the untruncated text behind a bounded payload', () => {
    const long = 'x'.repeat(PAYLOAD_MAX_CHARS + 1_000)
    const fold = new TrajectoryFold('s1')
    fold.consume(log([
      ['tool/call', { turn: 0, step: 0, callId: 'call-1', name: 'read', arguments: '{}' }, 1_000],
      ['tool/result', toolResult('call-1', long), 1_100],
    ]))

    const record = fold.snapshot(false).records[0]
    expect(record?.kind === 'tool' && record.result?.truncatedChars).toBe(1_000)
    expect(fold.payload('tool:call-1', 'result')).toHaveLength(long.length)
    // A payload the bound never touched is not retained twice.
    expect(fold.payload('tool:call-1', 'args')).toBeNull()
  })
})
