import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { createRealtimeStartClock } from './codex-realtime'

const item = (
  phase: 'started' | 'delta' | 'completed',
  itemId: string,
  text = '',
): AgentEvent => ({ type: 'realtime_transcript_item', phase, itemId, text, role: 'user', realtimeSessionId: 'rt-1' })

const stampOf = (event: AgentEvent): number | undefined => (
  event.type === 'realtime_transcript_item' ? event.startedAtMs : undefined
)

describe('realtime start clock', () => {
  it('stamps a started item and replays that stamp on its completion', () => {
    const stamp = createRealtimeStartClock()

    const started = stamp(item('started', 'item-1'))
    const completed = stamp(item('completed', 'item-1', 'hello'))

    expect(typeof stampOf(started)).toBe('number')
    expect(stampOf(completed)).toBe(stampOf(started))
  })

  it('keeps concurrent speakers on their own start times', () => {
    const stamp = createRealtimeStartClock()

    const user = stamp(item('started', 'user-1'))
    const assistant = stamp(item('started', 'assistant-1'))
    // Transcription can finish out of order; the stamp follows the item, not the order.
    const assistantDone = stamp(item('completed', 'assistant-1', 'on it'))
    const userDone = stamp(item('completed', 'user-1', 'read the file'))

    expect(stampOf(assistantDone)).toBe(stampOf(assistant))
    expect(stampOf(userDone)).toBe(stampOf(user))
  })

  it('leaves an item it never saw start unstamped', () => {
    const stamp = createRealtimeStartClock()

    expect(stampOf(stamp(item('completed', 'item-9', 'orphan')))).toBeUndefined()
  })

  it('passes deltas and non-transcript events through untouched', () => {
    const stamp = createRealtimeStartClock()
    const delta: AgentEvent = { type: 'realtime_transcript_item', phase: 'delta', itemId: 'item-1', text: 'he' }
    const closed: AgentEvent = { type: 'realtime_closed' }

    expect(stamp(delta)).toBe(delta)
    expect(stamp(closed)).toBe(closed)
  })

  it('drops a completed item from the pending map so a call cannot leak it', () => {
    const stamp = createRealtimeStartClock()

    stamp(item('started', 'item-1'))
    stamp(item('completed', 'item-1', 'hello'))

    // A second completion for the same id finds nothing left to inherit.
    expect(stampOf(stamp(item('completed', 'item-1', 'hello')))).toBeUndefined()
  })
})
