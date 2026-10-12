import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import { createLocalDelivery } from './local-delivery'

function textDelta(text: string, seq?: number): AgentEvent {
  return {
    type: 'content_delta',
    projectPath: '/p',
    sessionId: 's1',
    messageId: 'm1',
    delta: { type: 'text', text },
    seq,
  }
}

describe('renderer agent event transport', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces a stream window before sending one IPC payload', () => {
    const sent: AgentEvent[][] = []
    const transport = createLocalDelivery((events) => sent.push(events))
    transport.push(textDelta('a'))
    transport.push(textDelta('b'))

    vi.advanceTimersByTime(AGENT_EVENT_BATCH_MS)

    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(1)
    expect((sent[0][0] as Extract<AgentEvent, { type: 'content_delta' }>).delta).toEqual({ type: 'text', text: 'ab' })
  })

  it('keeps sequenced deltas separate but sends them in one IPC payload', () => {
    const sent: AgentEvent[][] = []
    const transport = createLocalDelivery((events) => sent.push(events))
    transport.push(textDelta('a', 1))
    transport.push(textDelta('b', 2))

    vi.advanceTimersByTime(AGENT_EVENT_BATCH_MS)

    expect(sent).toHaveLength(1)
    expect(sent[0].map((event) => event.seq)).toEqual([1, 2])
  })

  it('flushes queued deltas and a lifecycle event in one ordered payload', () => {
    const sent: AgentEvent[][] = []
    const transport = createLocalDelivery((events) => sent.push(events))
    transport.push(textDelta('a'))
    transport.push({ type: 'message_complete', messageId: 'm1' })

    expect(sent).toHaveLength(1)
    expect(sent[0].map((event) => event.type)).toEqual(['content_delta', 'message_complete'])
  })

  it('flushes pending output on dispose', () => {
    const sent: AgentEvent[][] = []
    const transport = createLocalDelivery((events) => sent.push(events))
    transport.push(textDelta('last'))
    transport.dispose()

    expect(sent).toHaveLength(1)
    expect(sent[0][0].type).toBe('content_delta')
  })
})
