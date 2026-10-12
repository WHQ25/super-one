import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  createAgentEventBatcher,
  AGENT_EVENT_BATCH_MS,
  coalesceAgentEventBatch,
  agentEventCoalesceKey,
} from './agent-event-batcher'

function delta(text: string, extra: Partial<AgentEvent> = {}): AgentEvent {
  return {
    type: 'content_delta',
    messageId: 'm1',
    projectPath: '/p',
    sessionId: 's1',
    delta: { type: 'text', text },
    ...extra,
  } as unknown as AgentEvent
}

function thinking(text: string, times?: { startedAt?: number; endedAt?: number }): AgentEvent {
  return {
    type: 'content_delta',
    messageId: 'm1',
    projectPath: '/p',
    sessionId: 's1',
    delta: { type: 'thinking', thinking: text, ...times },
  } as unknown as AgentEvent
}

function lifecycle(type: string): AgentEvent {
  return { type, messageId: 'm1' } as unknown as AgentEvent
}

describe('coalesceAgentEventBatch', () => {
  it('concatenates consecutive same-key text content_deltas', () => {
    const out = coalesceAgentEventBatch([delta('a'), delta('b'), delta('c')])
    expect(out).toHaveLength(1)
    expect((out[0] as { delta: { text: string } }).delta.text).toBe('abc')
  })

  it('does not fold across messageId boundaries', () => {
    const out = coalesceAgentEventBatch([
      delta('a'),
      delta('b', { messageId: 'm2' } as Partial<AgentEvent>),
    ])
    expect(out).toHaveLength(2)
  })

  it('preserves first startedAt and last endedAt for thinking folds', () => {
    const out = coalesceAgentEventBatch([
      thinking('a', { startedAt: 10 }),
      thinking('b', { endedAt: 99 }),
    ])
    expect(out).toHaveLength(1)
    const d = (out[0] as { delta: { thinking: string; startedAt?: number; endedAt?: number } }).delta
    expect(d.thinking).toBe('ab')
    expect(d.startedAt).toBe(10)
    expect(d.endedAt).toBe(99)
  })

  it('does not fold text with different isReplay flags', () => {
    const out = coalesceAgentEventBatch([
      delta('a'),
      delta('b', { isReplay: true } as Partial<AgentEvent>),
    ])
    expect(out).toHaveLength(2)
  })

  it('does not fold sequenced content_deltas (preserves per-seq replay dedup)', () => {
    const out = coalesceAgentEventBatch([
      delta('old', { seq: 1, epoch: 1 } as Partial<AgentEvent>),
      delta('new', { seq: 2, epoch: 1 } as Partial<AgentEvent>),
    ])
    expect(out).toHaveLength(2)
    expect((out[0] as { delta: { text: string }; seq?: number }).delta.text).toBe('old')
    expect((out[0] as { seq?: number }).seq).toBe(1)
    expect((out[1] as { delta: { text: string }; seq?: number }).delta.text).toBe('new')
    expect((out[1] as { seq?: number }).seq).toBe(2)
  })

  it('does not fold when only one side has seq', () => {
    const out = coalesceAgentEventBatch([
      delta('a'),
      delta('b', { seq: 5, epoch: 1 } as Partial<AgentEvent>),
    ])
    expect(out).toHaveLength(2)
  })

  it('folds identified text per id and never across ids', () => {
    const said = (id: string, text: string, extra: Partial<AgentEvent> = {}) => delta(text, { delta: { type: 'text', id, text }, ...extra } as Partial<AgentEvent>)
    const out = coalesceAgentEventBatch([said('a', 'He'), said('a', 'llo'), said('b', 'Hi')])
    expect(out.map(e => e.type === 'content_delta' && e.delta.type === 'text' ? [e.delta.id, e.delta.text] : null)).toEqual([['a', 'Hello'], ['b', 'Hi']])
  })

  it('lets a replacement supersede earlier appends and keeps later appends a replacement', () => {
    const said = (text: string, replace?: boolean) => delta(text, { delta: { type: 'text', id: 'a', text }, ...(replace ? { replace } : {}) } as Partial<AgentEvent>)
    const [folded] = coalesceAgentEventBatch([said('draft'), said('Final', true), said(' answer')])
    expect(folded).toMatchObject({ replace: true, delta: { text: 'Final answer' } })
  })

  it('folds streamed output of one tool call', () => {
    const out = (outputDelta: string) => ({ type: 'content_delta', messageId: 'm1', delta: { type: 'tool_use', toolUseId: 't1', toolName: 'Bash', input: '{"command":"ls"}', status: 'streaming', outputDelta } }) as AgentEvent
    const folded = coalesceAgentEventBatch([out('a'), out('b')])
    expect(folded).toHaveLength(1)
    expect(folded[0]).toMatchObject({ delta: { outputDelta: 'ab', input: '{"command":"ls"}' } })
  })
})

describe('agentEventCoalesceKey', () => {
  it('returns null for non-text content deltas', () => {
    const ev = {
      type: 'content_delta',
      messageId: 'm1',
      delta: { type: 'tool_use', toolUseId: 't1', toolName: 'Bash', input: '' },
    } as AgentEvent
    expect(agentEventCoalesceKey(ev)).toBeNull()
  })
})

describe('agent event batching', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces a burst of content deltas into a single flush and folds text', () => {
    const seen: AgentEvent[] = []
    const batcher = createAgentEventBatcher((e) => {
      seen.push(e)
    })

    batcher.push(delta('a'))
    batcher.push(delta('b'))
    batcher.push(delta('c'))
    expect(seen).toHaveLength(0)

    vi.advanceTimersByTime(AGENT_EVENT_BATCH_MS)
    expect(seen).toHaveLength(1)
    expect((seen[0] as { delta: { text: string } }).delta.text).toBe('abc')
  })

  it('dispatches an interactive event immediately without waiting for the window', () => {
    const seen: AgentEvent[] = []
    const batcher = createAgentEventBatcher((e) => seen.push(e))

    batcher.push(lifecycle('permission_request'))

    expect(seen.map((e) => e.type)).toEqual(['permission_request'])
  })

  it('preserves ordering when a non-delta arrives mid-burst (folded deltas first)', () => {
    const seen: AgentEvent[] = []
    const batcher = createAgentEventBatcher((e) => seen.push(e))

    batcher.push(delta('a'))
    batcher.push(delta('b'))
    batcher.push(lifecycle('message_complete'))

    // Queued deltas fold then land before the lifecycle event.
    expect(seen.map((e) => e.type)).toEqual(['content_delta', 'message_complete'])
    expect((seen[0] as { delta: { text: string } }).delta.text).toBe('ab')
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
    // After fold, a single event is dispatched — throw on that fold path is N/A.
    // Verify non-foldable interleave still survives throws: different message ids.
    const batcher = createAgentEventBatcher((e) => {
      const text = (e as unknown as { delta?: { text?: string } }).delta?.text
      if (text === 'boom') throw new Error('boom')
      seen.push(e)
    })

    batcher.push(delta('a'))
    batcher.push(delta('boom', { messageId: 'm-boom' } as Partial<AgentEvent>))
    batcher.push(delta('c', { messageId: 'm3' } as Partial<AgentEvent>))
    vi.advanceTimersByTime(AGENT_EVENT_BATCH_MS)

    expect(seen).toHaveLength(2)
  })
})
