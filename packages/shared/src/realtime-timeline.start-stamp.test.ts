import { describe, expect, it } from 'vitest'
import type { RealtimeTimelineSegment } from './agent-types'
import { mergePendingRealtimeTimelineSegments } from './realtime-timeline'

/**
 * Codex publishes realtime items without timestamps, so a start time only ever exists
 * on the copy SuperOne stamped. Every merge path has to hand it forward or a snapshot
 * refresh silently erases the timeline's scale.
 */
describe('merging realtime timeline segments preserves local start stamps', () => {
  const canonical = (id: string, text: string): RealtimeTimelineSegment => (
    { id, realtimeSessionId: 'rt-1', role: 'user', text }
  )

  it('carries the stamp of a pending segment onto its published copy', () => {
    const merged = mergePendingRealtimeTimelineSegments(
      [canonical('item-1', 'hello')],
      [{ id: 'local-1', sourceItemId: 'item-1', realtimeSessionId: 'rt-1', role: 'user', text: 'hello', startedAtMs: 1000 }],
      ['local-'],
    )

    expect(merged).toEqual([
      { id: 'item-1', realtimeSessionId: 'rt-1', role: 'user', text: 'hello', startedAtMs: 1000 },
    ])
  })

  it('keeps the stamp of an already published segment across a later snapshot', () => {
    const merged = mergePendingRealtimeTimelineSegments(
      [canonical('item-1', 'hello'), canonical('item-2', 'and again')],
      [{ ...canonical('item-1', 'hello'), startedAtMs: 1000 }],
      ['local-'],
    )

    expect(merged).toEqual([
      { id: 'item-1', realtimeSessionId: 'rt-1', role: 'user', text: 'hello', startedAtMs: 1000 },
      { id: 'item-2', realtimeSessionId: 'rt-1', role: 'user', text: 'and again' },
    ])
  })

  it('resolves stamps by text when a pending segment never learned its item id', () => {
    const merged = mergePendingRealtimeTimelineSegments(
      [canonical('item-1', 'hello')],
      [{ id: 'local-1', realtimeSessionId: 'rt-live', role: 'user', text: 'hello', startedAtMs: 1000 }],
      ['local-'],
    )

    expect(merged).toEqual([
      { id: 'item-1', realtimeSessionId: 'rt-1', role: 'user', text: 'hello', startedAtMs: 1000 },
    ])
  })

  it('gives repeated utterances their own stamp instead of sharing the first match', () => {
    const merged = mergePendingRealtimeTimelineSegments(
      [canonical('item-1', 'again'), canonical('item-2', 'again')],
      [
        { id: 'local-1', sourceItemId: 'item-1', realtimeSessionId: 'rt-1', role: 'user', text: 'again', startedAtMs: 1000 },
        { id: 'local-2', sourceItemId: 'item-2', realtimeSessionId: 'rt-1', role: 'user', text: 'again', startedAtMs: 4000 },
      ],
      ['local-'],
    )

    expect(merged.map((segment) => segment.startedAtMs)).toEqual([1000, 4000])
  })

  it('leaves a segment unstamped rather than borrowing one from an unrelated entry', () => {
    const merged = mergePendingRealtimeTimelineSegments(
      [canonical('item-1', 'hello'), canonical('item-2', 'unseen')],
      [{ id: 'local-1', sourceItemId: 'item-1', realtimeSessionId: 'rt-1', role: 'user', text: 'hello', startedAtMs: 1000 }],
      ['local-'],
    )

    expect(merged[1].startedAtMs).toBeUndefined()
  })
})
