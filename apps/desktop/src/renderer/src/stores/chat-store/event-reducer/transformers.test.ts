import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import {
  DEFAULT_PROVIDER,
  markMessageEventApplied,
  persistStreamingToolInput,
} from './transformers'

function assistant(id: string, blocks: ChatMessage['content'] = []): ChatMessage {
  return { id, role: 'assistant', status: 'streaming', content: blocks, createdAt: '', providerId: 'claude' }
}

describe('DEFAULT_PROVIDER', () => {
  it('is claude', () => {
    expect(DEFAULT_PROVIDER).toBe('claude')
  })
})

describe('markMessageEventApplied', () => {
  it('returns null when the event has no seq', () => {
    const messages = [assistant('m1')]
    expect(markMessageEventApplied(messages, 'm1', { type: 'status_change', status: 'idle' } as never)).toBeNull()
  })

  it('stamps seq and epoch onto the matching message only', () => {
    const messages = [assistant('m1'), assistant('m2')]
    const next = markMessageEventApplied(messages, 'm2', {
      type: 'content_delta', messageId: 'm2', seq: 7, epoch: 3,
      delta: { type: 'text', text: 'x' },
    } as never)
    expect(next).not.toBeNull()
    expect(next![0]).toBe(messages[0])
    expect(next![1]._lastAppliedSeq).toBe(7)
    expect(next![1]._lastAppliedEpoch).toBe(3)
  })
})

describe('persistStreamingToolInput', () => {
  it('returns the same array when input is undefined', () => {
    const messages = [assistant('m1')]
    expect(persistStreamingToolInput(messages, 'm1', 't1', undefined)).toBe(messages)
  })

  it('writes accumulated JSON onto the matching tool_use block', () => {
    const messages = [assistant('m1', [
      { type: 'tool_use', toolUseId: 't1', toolName: 'Edit', input: '' },
      { type: 'text', text: 'keep' },
    ])]
    const next = persistStreamingToolInput(messages, 'm1', 't1', '{"path":"a.ts"}')
    const block = next[0].content[0]
    expect(block.type).toBe('tool_use')
    if (block.type === 'tool_use') expect(block.input).toBe('{"path":"a.ts"}')
    expect(next[0].content[1]).toEqual({ type: 'text', text: 'keep' })
  })

  it('leaves other messages and tool ids untouched', () => {
    const messages = [
      assistant('m1', [{ type: 'tool_use', toolUseId: 't1', toolName: 'Edit', input: '' }]),
      assistant('m2', [{ type: 'tool_use', toolUseId: 't2', toolName: 'Edit', input: 'old' }]),
    ]
    const next = persistStreamingToolInput(messages, 'm1', 't1', '{"x":1}')
    expect(next[1]).toBe(messages[1])
    const other = next[1].content[0]
    expect(other.type).toBe('tool_use')
    if (other.type === 'tool_use') expect(other.input).toBe('old')
  })
})
