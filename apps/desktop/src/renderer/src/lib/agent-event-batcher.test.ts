import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { createAgentEventBatcher, AGENT_EVENT_BATCH_MS } from './agent-event-batcher'

function delta(text: string): AgentEvent {
  return { type: 'content_delta', messageId: 'm1', delta: { type: 'text', text } } as unknown as AgentEvent
}

function lifecycle(type: string): AgentEvent {
  return { type, messageId: 'm1' } as unknown as AgentEvent
}

describe('agent event batching', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces a burst of content deltas into a single flush', () => {
    const seen: AgentEvent[] = []
    const flushes: number[] = []
    const batcher = createAgentEventBatcher((e) => {
      seen.push(e)
      flushes.push(seen.length)
    })

    batcher.push(delta('a'))
    batcher.push(delta('b'))
    batcher.push(delta('c'))
    expect(seen).toHaveLength(0)

    vi.advanceTimersByTime(AGENT_EVENT_BATCH_MS)
    expect(seen).toHaveLength(3)
  })

  it('dispatches an interactive event immediately without waiting for the window', () => {
    const seen: AgentEvent[] = []
    const batcher = createAgentEventBatcher((e) => seen.push(e))

    batcher.push(lifecycle('permission_request'))

    expect(seen.map((e) => e.type)).toEqual(['permission_request'])
  })

  it('preserves ordering when a non-delta arrives mid-burst', () => {
    const seen: AgentEvent[] = []
    const batcher = createAgentEventBatcher((e) => seen.push(e))

    batcher.push(delta('a'))
    batcher.push(delta('b'))
    batcher.push(lifecycle('message_complete'))

    // The queued deltas must land before the lifecycle event, not after it.
    expect(seen.map((e) => e.type)).toEqual(['content_delta', 'content_delta', 'message_complete'])
  })

  it('does not re-flush queued deltas after an immediate event drained them', () => {
    const seen: AgentEvent[] = []
    const batcher = createAgentEventBatcher((e) => seen.push(e))

    batcher.push(delta('a'))
    batcher.push(lifecycle('message_complete'))
    vi.advanceTimersByTime(AGENT_EVENT_BATCH_MS * 4)

    expect(seen).toHaveLength(2)
  })

  it('starts a fresh window for deltas that arrive after a flush', () => {
    const seen: AgentEvent[] = []
    const batcher = createAgentEventBatcher((e) => seen.push(e))

    batcher.push(delta('a'))
    vi.advanceTimersByTime(AGENT_EVENT_BATCH_MS)
    expect(seen).toHaveLength(1)

    batcher.push(delta('b'))
    expect(seen).toHaveLength(1)
    vi.advanceTimersByTime(AGENT_EVENT_BATCH_MS)
    expect(seen).toHaveLength(2)
  })

  it('flushes pending deltas on dispose so no streamed text is dropped', () => {
    const seen: AgentEvent[] = []
    const batcher = createAgentEventBatcher((e) => seen.push(e))

    batcher.push(delta('a'))
    batcher.dispose()

    expect(seen).toHaveLength(1)

    // The timer must be cancelled — a post-dispose tick may not dispatch again.
    vi.advanceTimersByTime(AGENT_EVENT_BATCH_MS * 4)
    expect(seen).toHaveLength(1)
  })

  it('survives a throwing immediate event so the IPC callback stays alive', () => {
    const seen: AgentEvent[] = []
    const batcher = createAgentEventBatcher((e) => {
      if (e.type === 'message_error') throw new Error('boom')
      seen.push(e)
    })

    expect(() => batcher.push(lifecycle('message_error'))).not.toThrow()

    batcher.push(lifecycle('message_complete'))
    expect(seen.map((e) => e.type)).toEqual(['message_complete'])
  })

  it('keeps dispatching later events even when one throws', () => {
    const seen: AgentEvent[] = []
    const batcher = createAgentEventBatcher((e) => {
      if ((e as unknown as { delta?: { text?: string } }).delta?.text === 'boom') throw new Error('boom')
      seen.push(e)
    })

    batcher.push(delta('a'))
    batcher.push(delta('boom'))
    batcher.push(delta('c'))
    vi.advanceTimersByTime(AGENT_EVENT_BATCH_MS)

    expect(seen).toHaveLength(2)
  })
})
