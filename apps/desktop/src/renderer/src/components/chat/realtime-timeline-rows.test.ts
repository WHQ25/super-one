import { describe, expect, it } from 'vitest'
import type { RealtimeTimelineSegment } from '@superone/shared/agent-types'
import { buildRealtimeTimelineRows, formatTimelineOffset } from './realtime-timeline-rows'

const segment = (
  id: string,
  startedAtMs?: number,
  realtimeSessionId = 'rt-1',
): RealtimeTimelineSegment => ({
  id,
  realtimeSessionId,
  role: 'user',
  text: id,
  ...(startedAtMs === undefined ? {} : { startedAtMs }),
})

const BASE = 1_700_000_000_000

describe('building realtime timeline rows', () => {
  it('places each utterance on the scale its own call started', () => {
    const rows = buildRealtimeTimelineRows([
      segment('a', BASE),
      segment('b', BASE + 18_000),
      // A second call reuses the thread hours later and restarts at zero.
      segment('c', BASE + 7_200_000, 'rt-2'),
      segment('d', BASE + 7_205_000, 'rt-2'),
    ])

    expect(rows.map((row) => row.offsetSeconds)).toEqual([0, 18, 0, 5])
    expect(rows.map((row) => row.callStart)).toEqual([true, false, true, false])
    expect(rows.map((row) => row.callStartedAtMs)).toEqual([BASE, BASE, BASE + 7_200_000, BASE + 7_200_000])
  })

  it('marks a long pause and leaves ordinary turn-taking unmarked', () => {
    const rows = buildRealtimeTimelineRows([
      segment('a', BASE),
      segment('b', BASE + 12_000),
      segment('c', BASE + 84_000),
    ])

    expect(rows.map((row) => row.silenceSeconds)).toEqual([null, null, 72])
  })

  it('does not carry a silence across a call boundary', () => {
    const rows = buildRealtimeTimelineRows([
      segment('a', BASE),
      segment('b', BASE + 7_200_000, 'rt-2'),
    ])

    expect(rows[1].silenceSeconds).toBeNull()
  })

  it('keeps unstamped segments in order without inventing a tick', () => {
    const rows = buildRealtimeTimelineRows([segment('a'), segment('b'), segment('c')])

    expect(rows.map((row) => row.offsetSeconds)).toEqual([null, null, null])
    expect(rows.map((row) => row.segment.id)).toEqual(['a', 'b', 'c'])
    expect(rows[0].callStartedAtMs).toBeNull()
  })

  it('anchors a call whose opening segments predate stamping', () => {
    const rows = buildRealtimeTimelineRows([
      segment('a'),
      segment('b', BASE),
      segment('c', BASE + 9_000),
    ])

    expect(rows.map((row) => row.offsetSeconds)).toEqual([null, 0, 9])
    // The header of a partly stamped call still knows when it began.
    expect(rows[0].callStartedAtMs).toBe(BASE)
  })
})

describe('formatting a timeline offset', () => {
  it('pads to mm:ss and widens past an hour', () => {
    expect(formatTimelineOffset(0)).toBe('00:00')
    expect(formatTimelineOffset(9)).toBe('00:09')
    expect(formatTimelineOffset(154)).toBe('02:34')
    expect(formatTimelineOffset(3661)).toBe('1:01:01')
  })
})
