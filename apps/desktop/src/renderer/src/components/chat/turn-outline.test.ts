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
  it('extracts user turns with id, text, createdAt and reply in order', () => {
    const out = extractTurnOutline([
      msg({ id: 'u1', content: [text('first question')], createdAt: 'a' }),
      msg({ id: 'a1', role: 'assistant', content: [text('answer')] }),
      msg({ id: 'u2', content: [text('second question')], createdAt: 'b' }),
    ])
    expect(out).toEqual([
      { id: 'u1', index: 0, text: 'first question', createdAt: 'a', reply: 'answer' },
      { id: 'u2', index: 2, text: 'second question', createdAt: 'b', reply: undefined },
    ])
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

  it('excludes assistant messages', () => {
    const out = extractTurnOutline([msg({ role: 'assistant', content: [text('hi')] })])
    expect(out).toEqual([])
  })

  it('excludes compact markers (providerId system)', () => {
    const out = extractTurnOutline([
      msg({ id: 'c', providerId: 'system', content: [text('__compact__:auto:1200')] }),
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
      msg({ id: 'c', providerId: 'system', content: [text('__compact__:auto:1200')] }),
      msg({ id: 'a', role: 'assistant', content: [text('answer')] }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].reply).toBe('answer')
  })

  it('reports the source array index so callers can locate the compact split', () => {
    const messages = [
      msg({ id: 'u1', content: [text('q1')] }),
      msg({ id: 'a1', role: 'assistant', content: [text('a1')] }),
      msg({ id: 'c', providerId: 'system', content: [text('__compact__:auto:1')] }),
      msg({ id: 'u2', content: [text('q2')] }),
    ]
    const out = extractTurnOutline(messages)
    const compactIdx = 2
    const recent = out.filter((e) => e.index >= compactIdx).length
    expect(recent).toBe(1)
    expect(out.length - recent).toBe(1)
  })
})
