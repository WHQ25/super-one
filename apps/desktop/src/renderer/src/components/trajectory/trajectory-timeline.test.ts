import { describe, expect, it } from 'vitest'
import type { TrajectoryProjection, TrajectoryRecord } from '@superone/shared/trajectory-types'
import {
  buildSegments,
  buildTimeline,
  idsInRange,
  isZoomed,
  linearProjector,
  segmentAt,
  segmentedProjector,
  timelineTicks,
} from './trajectory-timeline'

function message(index: number, startedAt: number, durationMs: number, ttftMs: number | null): TrajectoryRecord {
  return {
    id: `message:${index}`,
    index,
    kind: 'message',
    seq: index,
    turn: 1,
    step: index,
    request: index,
    startedAt,
    durationMs,
    summary: 'thinking',
    text: { text: 'thinking' },
    thinking: null,
    blocks: [],
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: null,
    ttftMs,
  }
}

function tool(index: number, startedAt: number, durationMs: number | null): TrajectoryRecord {
  return {
    id: `tool:${index}`,
    index,
    kind: 'tool',
    seq: index,
    turn: 1,
    step: 1,
    request: 1,
    startedAt,
    durationMs,
    summary: 'read',
    name: 'read',
    callId: `call-${index}`,
    args: { text: '{}' },
    result: durationMs === null ? null : { text: 'ok' },
    schema: null,
    isError: false,
    error: null,
  }
}

function windowOf(records: TrajectoryRecord[]): TrajectoryProjection {
  return {
    sessionId: 's1',
    headers: [],
    records,
    requests: [],
    turns: [{ turn: 1, startedAt: 1_000, durationMs: null, outcome: null, steps: 1, toolCalls: 1 }],
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    firstIndex: 1,
    total: records.length,
    cursor: records.length,
    live: false,
  }
}

describe('buildTimeline', () => {
  it('separates model work from tool work and marks where decoding began', () => {
    const model = buildTimeline(windowOf([
      message(1, 1_000, 900, 300),
      tool(2, 2_000, 400),
    ]))

    expect(model?.start).toBe(1_000)
    expect(model?.end).toBe(2_400)
    expect(model?.spans.map((span) => span.lane)).toEqual([1, 2])
    // TTFT splits the assistant bar: waiting for a provider and generating a
    // long answer are the same width otherwise.
    expect(model?.spans[0]?.firstToken).toBe(1_300)
    expect(model?.spans[1]?.firstToken).toBeNull()
  })

  it('projects a still-running record as an instant rather than stretching it', () => {
    const model = buildTimeline(windowOf([tool(1, 1_000, null)]))

    // Nothing knows when this call ends, and drawing it to "now" would invent
    // a duration that the ledger explicitly refuses to report.
    expect(model?.spans[0]).toMatchObject({ start: 1_000, end: 1_000 })
  })

  it('returns nothing for a window with no records', () => {
    expect(buildTimeline(windowOf([]))).toBeNull()
  })
})

describe('idsInRange', () => {
  it('keeps every record whose activity overlaps the selection, inclusive of its edges', () => {
    const model = buildTimeline(windowOf([
      message(1, 1_000, 500, null),
      tool(2, 2_000, 500),
      tool(3, 5_000, 100),
    ]))!

    expect(idsInRange(model, { start: 1_400, end: 2_000 })).toEqual(new Set(['message:1', 'tool:2']))
    expect(idsInRange(model, null)).toBeNull()
  })
})

describe('timelineTicks', () => {
  it('picks a step a reader can do arithmetic with, not one that merely fits', () => {
    // 12s over ~6 labels wants 2s, which is on the ladder; 2.4s is not.
    const { step } = timelineTicks({ start: 1_000, end: 13_000 }, 1_000)
    expect(step).toBe(2_000)

    // Zooming in two orders of magnitude has to change the step, or the ruler
    // would look identical and the zoom would be invisible.
    const zoomed = timelineTicks({ start: 1_000, end: 1_120 }, 1_000)
    expect(zoomed.step).toBe(25)
  })

  it('aligns ticks to the session start so a label keeps its value while panning', () => {
    const origin = 1_000
    const { ticks } = timelineTicks({ start: 4_400, end: 10_000 }, origin, 6)

    expect(ticks.every((tick) => tick.offset % 1_000 === 0)).toBe(true)
    // The first tick at or past the viewport's start: offset 4000 is absolute
    // time 5000, which is inside a viewport that begins at 4400.
    expect(ticks[0]?.offset).toBe(4_000)
    expect(ticks[0]?.time).toBe(5_000)
    expect(ticks.every((tick) => tick.time === origin + tick.offset)).toBe(true)
  })
})

describe('isZoomed', () => {
  it('is false only while the whole domain is visible', () => {
    const model = buildTimeline(windowOf([message(1, 1_000, 500, null), tool(2, 3_000, 200)]))!

    expect(isZoomed({ start: model.start, end: model.end }, model)).toBe(false)
    expect(isZoomed({ start: model.start + 100, end: model.end }, model)).toBe(true)
    expect(isZoomed({ start: model.start, end: model.end - 100 }, model)).toBe(true)
  })
})

describe('buildSegments', () => {
  const projection = {
    ...windowOf([message(1, 1_000, 500, null), tool(2, 3_000, 200)]),
    turns: [
      { turn: 1, startedAt: 1_000, durationMs: 900, outcome: 'completed', steps: 1, toolCalls: 1 },
      // Still running: no duration was recorded for it yet.
      { turn: 2, startedAt: 2_500, durationMs: null, outcome: null, steps: 1, toolCalls: 0 },
    ],
    requests: [
      { ordinal: 1, seq: 1, purpose: 'generation' as const, turn: 1, step: 1, startedAt: 1_000, durationMs: 400, ttftMs: null, usage: null, route: null, header: null },
      { ordinal: 2, seq: 5, purpose: 'compaction' as const, turn: 1, step: null, startedAt: 2_000, durationMs: 300, ttftMs: null, usage: null, route: null, header: null },
    ],
  }
  const model = buildTimeline(projection)!

  it('has no divisions in time mode, where the ruler carries them', () => {
    expect(buildSegments(projection, 'time', model)).toEqual([])
  })

  it('runs an unfinished turn up to whatever starts next instead of inventing a length', () => {
    const segments = buildSegments(projection, 'turn', model)

    expect(segments.map((segment) => segment.label)).toEqual(['Turn 1', 'Turn 2'])
    expect(segments[0]).toMatchObject({ start: 1_000, end: 1_900 })
    // Turn 2 has no duration, so it reaches the end of the loaded domain.
    expect(segments[1]).toMatchObject({ start: 2_500, end: model.end })
  })

  it('marks a compaction call apart from a generation call', () => {
    const segments = buildSegments(projection, 'request', model)

    expect(segments.map((segment) => segment.label)).toEqual(['#1', '#2'])
    expect(segments[0]?.aside).toBe(false)
    expect(segments[1]?.aside).toBe(true)
  })
})

describe('segmentAt', () => {
  it('locates the segment an instant falls in, and none between segments', () => {
    const segments = [
      { key: 'a', label: 'Turn 1', ordinal: 1, start: 1_000, end: 1_500 },
      { key: 'b', label: 'Turn 2', ordinal: 2, start: 2_000, end: 2_400 },
    ]

    expect(segmentAt(segments, 1_200)?.key).toBe('a')
    expect(segmentAt(segments, 1_500)?.key).toBe('a')
    expect(segmentAt(segments, 1_700)).toBeNull()
    expect(segmentAt(segments, 2_400)?.key).toBe('b')
    expect(segmentAt(segments, 9_000)).toBeNull()
  })
})

describe('segmentedProjector', () => {
  // A four-minute first turn beside two short ones: the case the ordinal axis
  // exists for, since proportional width would leave the short two unreadable.
  const segments = [
    { key: 'a', label: 'Turn 1', ordinal: 1, start: 0, end: 240_000 },
    { key: 'b', label: 'Turn 2', ordinal: 2, start: 250_000, end: 251_000 },
    { key: 'c', label: 'Turn 3', ordinal: 3, start: 260_000, end: 262_000 },
  ]
  const projector = segmentedProjector(segments, { start: 0, end: 262_000 })

  it('gives every segment the same width whatever it cost', () => {
    expect(projector.toFraction(0)).toBeCloseTo(0)
    expect(projector.toFraction(240_000)).toBeCloseTo(1 / 3)
    expect(projector.toFraction(250_000)).toBeCloseTo(1 / 3)
    expect(projector.toFraction(251_000)).toBeCloseTo(2 / 3)
    expect(projector.toFraction(262_000)).toBeCloseTo(1)
  })

  it('keeps proportion inside a segment', () => {
    expect(projector.toFraction(120_000)).toBeCloseTo(1 / 6)
    expect(projector.toFraction(250_500)).toBeCloseTo(1 / 3 + 1 / 6)
  })

  it('collapses the time between segments to their shared boundary', () => {
    // Nothing ran between 241s and 250s, so it takes no width.
    expect(projector.toFraction(245_000)).toBeCloseTo(1 / 3)
  })

  it('round-trips a pointer position back to a time inside the same segment', () => {
    for (const fraction of [0, 0.2, 1 / 3, 0.5, 0.9, 1]) {
      const time = projector.toTime(fraction)
      expect(projector.toFraction(time)).toBeCloseTo(fraction, 5)
    }
  })

  it('falls back to the wall clock when there is nothing to divide', () => {
    const empty = segmentedProjector([], { start: 1_000, end: 2_000 })
    expect(empty.toFraction(1_500)).toBeCloseTo(linearProjector({ start: 1_000, end: 2_000 }).toFraction(1_500))
  })
})
