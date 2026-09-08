import { describe, expect, it } from 'vitest'
import type { AgentEvent, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import { mergeRealtimeTranscript } from '@superone/shared/realtime-transcript'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'
import type { ChatCoreSession } from './types'

const session = (overrides: Partial<ChatCoreSession> = {}): ChatCoreSession => ({
  ...createDefaultChatCoreSession(),
  ...overrides,
})

const completed = (itemId: string, role: 'user' | 'assistant', text: string, startedAtMs?: number): AgentEvent => ({
  type: 'realtime_transcript_item',
  phase: 'completed',
  itemId,
  text,
  role,
  realtimeSessionId: 'rt-1',
  ...(startedAtMs === undefined ? {} : { startedAtMs }),
})

describe('realtime voice reduction', () => {
  it('tracks the live call id across start and close', () => {
    expect(applyEventToSession(session(), { type: 'realtime_started', realtimeSessionId: 'rt-1', version: '1' }))
      .toEqual({ realtimeSessionId: 'rt-1' })
    expect(applyEventToSession(session({ realtimeSessionId: 'rt-1' }), { type: 'realtime_closed' }))
      .toEqual({ realtimeSessionId: null })
  })

  it('keeps a completed utterance', () => {
    const patch = applyEventToSession(session(), completed('item-1', 'user', 'hello there', 1000))
    expect(patch.realtimeSegments).toEqual([{
      id: 'live-item-1',
      sourceItemId: 'item-1',
      realtimeSessionId: 'rt-1',
      role: 'user',
      text: 'hello there',
      provenance: 'realtime-user',
      startedAtMs: 1000,
    }])
  })

  it('ignores partials, blank text, and role-less events', () => {
    const base = session({ realtimeSessionId: 'rt-1' })
    for (const event of [
      { type: 'realtime_transcript_item', phase: 'delta', itemId: 'item-1', text: 'hel' },
      { type: 'realtime_transcript_item', phase: 'started', itemId: 'item-1', text: '', role: 'user' },
      { type: 'realtime_transcript_item', phase: 'completed', itemId: 'item-1', text: '   ', role: 'user' },
      { type: 'realtime_transcript_item', phase: 'completed', itemId: 'item-1', text: 'hi' },
    ] as AgentEvent[]) {
      expect(applyEventToSession(base, event)).toEqual({})
    }
  })

  it('falls back to the session call id when the event omits one', () => {
    const patch = applyEventToSession(session({ realtimeSessionId: 'rt-7' }), {
      type: 'realtime_transcript_item', phase: 'completed', itemId: 'item-1', text: 'hi', role: 'user',
    })
    expect(patch.realtimeSegments?.[0].realtimeSessionId).toBe('rt-7')
  })

  it('collapses an utterance replayed out of the restore buffer', () => {
    // `index.ts` persists before it broadcasts, so the snapshot the phone fetched
    // already holds this utterance — under the local id the desktop minted for it.
    const fromSnapshot: RealtimeTimelineSegment = {
      id: 'local-abc', sourceItemId: 'item-1', realtimeSessionId: 'rt-1',
      role: 'user', text: 'said once', provenance: 'realtime-user', startedAtMs: 1000,
    }
    const patch = applyEventToSession(
      session({ realtimeSegments: [fromSnapshot], realtimeSessionId: 'rt-1' }),
      completed('item-1', 'user', 'said once', 1000),
    )
    expect(patch.realtimeSegments).toHaveLength(1)
    expect(mergeRealtimeTranscript([], patch.realtimeSegments!)).toHaveLength(1)
  })

  it('appends a genuinely new utterance beside the restored ones', () => {
    const restored: RealtimeTimelineSegment = {
      id: 'local-abc', sourceItemId: 'item-1', realtimeSessionId: 'rt-1',
      role: 'user', text: 'first', provenance: 'realtime-user', startedAtMs: 1000,
    }
    const patch = applyEventToSession(
      session({ realtimeSegments: [restored], realtimeSessionId: 'rt-1' }),
      completed('item-2', 'assistant', 'second', 2000),
    )
    expect(patch.realtimeSegments?.map((segment) => segment.text)).toEqual(['first', 'second'])
  })
})
