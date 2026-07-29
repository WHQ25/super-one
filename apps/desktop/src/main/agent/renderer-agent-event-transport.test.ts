import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, CodexThreadItem } from '@superone/shared/agent-types'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import { createRendererAgentEventTransport } from './renderer-agent-event-transport'

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

function codexDelta(item: CodexThreadItem, phase: 'started' | 'updated' | 'completed' = 'updated'): AgentEvent {
  return {
    type: 'codex_item_delta',
    projectPath: '/p',
    sessionId: 's1',
    messageId: 'm1',
    phase,
    item,
  }
}

describe('renderer agent event transport', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces a stream window before sending one IPC payload', () => {
    const sent: AgentEvent[][] = []
    const transport = createRendererAgentEventTransport((events) => sent.push(events))
    transport.push(textDelta('a'))
    transport.push(textDelta('b'))

    vi.advanceTimersByTime(AGENT_EVENT_BATCH_MS)

    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(1)
    expect((sent[0][0] as Extract<AgentEvent, { type: 'content_delta' }>).delta).toEqual({ type: 'text', text: 'ab' })
  })

  it('keeps sequenced deltas separate but sends them in one IPC payload', () => {
    const sent: AgentEvent[][] = []
    const transport = createRendererAgentEventTransport((events) => sent.push(events))
    transport.push(textDelta('a', 1))
    transport.push(textDelta('b', 2))

    vi.advanceTimersByTime(AGENT_EVENT_BATCH_MS)

    expect(sent).toHaveLength(1)
    expect(sent[0].map((event) => event.seq)).toEqual([1, 2])
  })

  it('flushes queued deltas and a lifecycle event in one ordered payload', () => {
    const sent: AgentEvent[][] = []
    const transport = createRendererAgentEventTransport((events) => sent.push(events))
    transport.push(textDelta('a'))
    transport.push({ type: 'message_complete', messageId: 'm1' })

    expect(sent).toHaveLength(1)
    expect(sent[0].map((event) => event.type)).toEqual(['content_delta', 'message_complete'])
  })

  it('encodes additive Codex text updates as suffix patches', () => {
    const sent: AgentEvent[][] = []
    const transport = createRendererAgentEventTransport((events) => sent.push(events))
    transport.push(codexDelta({ id: 'i1', type: 'reasoning', text: 'first', startedAt: 10 }, 'started'))
    transport.flush()
    transport.push(codexDelta({ id: 'i1', type: 'reasoning', text: 'first second', startedAt: 10, endedAt: 20 }))
    transport.flush()

    expect(sent[0][0].type).toBe('codex_item_delta')
    expect(sent[1][0]).toMatchObject({
      type: 'codex_item_patch',
      itemId: 'i1',
      patch: { type: 'reasoning', textDelta: ' second', startedAt: 10, endedAt: 20 },
    })
  })

  it('encodes additive command output only while command metadata is stable', () => {
    const sent: AgentEvent[][] = []
    const transport = createRendererAgentEventTransport((events) => sent.push(events))
    transport.push(codexDelta({
      id: 'c1', type: 'command_execution', command: 'pwd', aggregatedOutput: '/a', status: 'in_progress',
    }, 'started'))
    transport.flush()
    transport.push(codexDelta({
      id: 'c1', type: 'command_execution', command: 'pwd', aggregatedOutput: '/a/b', status: 'in_progress',
    }))
    transport.flush()
    transport.push(codexDelta({
      id: 'c1', type: 'command_execution', command: 'pwd', aggregatedOutput: '/a/b', status: 'completed', exitCode: 0,
    }))
    transport.flush()

    expect(sent[1][0]).toMatchObject({
      type: 'codex_item_patch',
      patch: { type: 'command_execution', aggregatedOutputDelta: '/b' },
    })
    expect(sent[2][0].type).toBe('codex_item_delta')
  })

  it('falls back to a full snapshot for non-additive text', () => {
    const sent: AgentEvent[][] = []
    const transport = createRendererAgentEventTransport((events) => sent.push(events))
    transport.push(codexDelta({ id: 'i1', type: 'agent_message', text: 'first' }, 'started'))
    transport.flush()
    transport.push(codexDelta({ id: 'i1', type: 'agent_message', text: 'replacement' }))
    transport.flush()

    expect(sent[1][0].type).toBe('codex_item_delta')
  })

  it('sends a full snapshot after a message baseline is cleared', () => {
    const sent: AgentEvent[][] = []
    const transport = createRendererAgentEventTransport((events) => sent.push(events))
    transport.push(codexDelta({ id: 'i1', type: 'agent_message', text: 'a' }, 'started'))
    transport.flush()
    transport.push({ type: 'message_complete', projectPath: '/p', sessionId: 's1', messageId: 'm1' })
    transport.push(codexDelta({ id: 'i1', type: 'agent_message', text: 'ab' }))
    transport.flush()

    expect(sent.at(-1)?.[0].type).toBe('codex_item_delta')
  })

  it('flushes pending output on dispose', () => {
    const sent: AgentEvent[][] = []
    const transport = createRendererAgentEventTransport((events) => sent.push(events))
    transport.push(textDelta('last'))
    transport.dispose()

    expect(sent).toHaveLength(1)
    expect(sent[0][0].type).toBe('content_delta')
  })
})
