import { describe, it, expect } from 'vitest'
import { extractTurnOutline } from './turn-outline'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

function msg(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm',
    role: 'user',
    status: 'complete',
    content: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'claude',
    ...over,
  } as ChatMessage
}

const text = (t: string): ContentBlock => ({ type: 'text', text: t })

describe('extractTurnOutline', () => {
  it('extracts one entry per user message, with the first assistant text as its reply', () => {
    const out = extractTurnOutline([
      msg({ id: 'u1', content: [text('first question')], createdAt: 'a' }),
      msg({ id: 'a1', role: 'assistant', content: [text('answer')] }),
      msg({ id: 'u2', content: [text('second question')], createdAt: 'b' }),
    ])
    expect(out).toMatchObject([
      { id: 'u1', index: 0, text: 'first question', createdAt: 'a', reply: 'answer' },
      { id: 'u2', index: 2, text: 'second question', createdAt: 'b' },
    ])
    expect(out).toHaveLength(2)
  })

  it('attaches the first assistant text reply, skipping intermediate tool messages', () => {
    const out = extractTurnOutline([
      msg({ id: 'u', content: [text('do it')] }),
      msg({ id: 'a-tool', role: 'assistant', content: [] }),
      msg({ id: 'a-text', role: 'assistant', content: [text('done now')] }),
    ])
    expect(out[0].reply).toBe('done now')
  })

  it('leaves reply undefined for a trailing user turn with no answer yet', () => {
    const out = extractTurnOutline([msg({ id: 'u', content: [text('pending')] })])
    expect(out[0].reply).toBeUndefined()
  })

  it('does not add assistant text segments as entries', () => {
    const out = extractTurnOutline([
      msg({ id: 'a', role: 'assistant', content: [text('hi'), { type: 'tool_use', toolUseId: 't', toolName: 'Bash', input: '', status: 'complete' } as ContentBlock, text('again')] }),
    ])
    expect(out).toEqual([])
  })

  it('includes compaction points as compact entries', () => {
    const out = extractTurnOutline([
      msg({ id: 'c', providerId: 'system', role: 'assistant', content: [text('__compact__:auto:1200')] }),
    ])
    expect(out).toMatchObject([{ id: 'c', kind: 'compact', index: 0 }])
  })

  it('excludes other system markers', () => {
    const out = extractTurnOutline([
      msg({ id: 's', providerId: 'system', role: 'assistant', content: [text('__turn_meta__:summary:x')] }),
    ])
    expect(out).toEqual([])
  })

  it('excludes turns with no text (image-only)', () => {
    const out = extractTurnOutline([
      msg({ content: [{ type: 'image', name: 'shot.png' } as ContentBlock] }),
    ])
    expect(out).toEqual([])
  })

  it('joins multiple text blocks', () => {
    const out = extractTurnOutline([msg({ id: 'u', content: [text('line one'), text('line two')] })])
    expect(out[0].text).toBe('line one\nline two')
  })

  it('trims whitespace and skips blank turns', () => {
    const out = extractTurnOutline([msg({ content: [text('   \n  ')] })])
    expect(out).toEqual([])
  })

  it('does not attach a reply across an intervening user turn', () => {
    const out = extractTurnOutline([
      msg({ id: 'u1', content: [text('q1')] }),
      msg({ id: 'u2', content: [text('q2')] }),
      msg({ id: 'a', role: 'assistant', content: [text('a2')] }),
    ])
    expect(out[0].reply).toBeUndefined()
    expect(out[1].reply).toBe('a2')
  })

  it('keeps the reply search open across a system (compact) message', () => {
    const out = extractTurnOutline([
      msg({ id: 'u', content: [text('q')] }),
      msg({ id: 'c', providerId: 'system', role: 'assistant', content: [text('__compact__:auto:1200')] }),
      msg({ id: 'a', role: 'assistant', content: [text('answer')] }),
    ])
    expect(out).toMatchObject([{ id: 'u', reply: 'answer' }, { id: 'c', kind: 'compact', reply: 'answer' }])
  })

  it('places the compaction point between the turns it separates', () => {
    const messages = [
      msg({ id: 'u1', content: [text('q1')] }),
      msg({ id: 'a1', role: 'assistant', content: [text('a1')] }),
      msg({ id: 'c', providerId: 'system', role: 'assistant', content: [text('__compact__:auto:1')] }),
      msg({ id: 'u2', content: [text('q2')] }),
    ]
    const out = extractTurnOutline(messages)
    expect(out).toMatchObject([
      { id: 'u1', index: 0, reply: 'a1' },
      { id: 'c', kind: 'compact', index: 2 },
      { id: 'u2', index: 3 },
    ])
    expect(out[1].reply).toBeUndefined()
  })

  it('previews the first assistant text after a compaction as its reply', () => {
    const out = extractTurnOutline([
      msg({ id: 'u', content: [text('q')] }),
      msg({ id: 'a1', role: 'assistant', content: [text('before')] }),
      msg({ id: 'c', providerId: 'system', role: 'assistant', content: [text('__compact__:auto:1')] }),
      msg({ id: 'a2', role: 'assistant', content: [text('after')] }),
    ])
    expect(out).toMatchObject([{ id: 'u', reply: 'before' }, { id: 'c', kind: 'compact', reply: 'after' }])
  })
})
