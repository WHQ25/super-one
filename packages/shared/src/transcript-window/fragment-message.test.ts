import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../agent-types'
import { contentDigest, utf8Length } from './content-digest'
import { MAX_FRAGMENT_BYTES, MessageFragmenter, blockKeys, fragmentMessage } from './fragment-message'
import { FRAGMENT_TEXT_CHARS } from './text-cuts'

function reply(text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'a1', role: 'assistant', status: 'streaming', createdAt: '2026-10-13T00:00:00.000Z', providerId: 'claude',
    content: [{ type: 'text', text }], ...extra,
  }
}

const long = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i} of a long reply that keeps going.`).join('\n')

describe('contentDigest', () => {
  it('is stable and sensitive to content', () => {
    expect(contentDigest('abc')).toBe(contentDigest('abc'))
    expect(contentDigest('abc')).not.toBe(contentDigest('abd'))
    expect(contentDigest('abc')).toHaveLength(14)
  })

  it('counts UTF-8 bytes', () => {
    expect(utf8Length('aé中😀')).toBe(1 + 2 + 3 + 4)
  })
})

describe('fragmentMessage', () => {
  it('keeps earlier fragment keys and digests as a reply grows', () => {
    const fragmenter = new MessageFragmenter()
    const text = long(800)
    const early = fragmenter.fragment(reply(text.slice(0, FRAGMENT_TEXT_CHARS * 3)))
    const later = fragmenter.fragment(reply(text))
    const fresh = fragmentMessage(reply(text))
    expect(later.fragments.map((f) => [f.key, f.digest])).toEqual(fresh.fragments.map((f) => [f.key, f.digest]))
    const settled = early.fragments.slice(0, -1)
    expect(later.fragments.slice(0, settled.length).map((f) => f.digest)).toEqual(settled.map((f) => f.digest))
    expect(later.fragments.every((f) => f.bytes <= MAX_FRAGMENT_BYTES)).toBe(true)
  })

  it('keys tools by id and text by provider id or ordinal', () => {
    expect(blockKeys([
      { type: 'text', text: 'a' },
      { type: 'tool_use', toolName: 'Bash', toolUseId: 't1', input: '{}' },
      { type: 'tool_result', toolUseId: 't1', summary: 'ok' },
      { type: 'text', id: 'item_1', text: 'b' },
      { type: 'text', text: 'c' },
    ])).toEqual(['text::0', 'tool:t1', 'tool_result:t1', 'text#item_1', 'text::1'])
  })

  it('splits attachments out of the meta and omits a block too large for a fragment', () => {
    const message: ChatMessage = {
      id: 'u1', role: 'user', status: 'complete', createdAt: '2026-10-13T00:00:00.000Z', providerId: 'claude',
      content: [
        { type: 'text', text: 'see image' },
        { type: 'tool_result', toolUseId: 'x', summary: 'y'.repeat(MAX_FRAGMENT_BYTES + 10) },
      ],
      attachments: [{ id: 'img', name: 'a.png', mediaType: 'image/png', preview: 'data' } as never],
    }
    const result = fragmentMessage(message)
    expect(result.meta).not.toHaveProperty('attachments')
    expect(result.fragments.map((f) => f.body.kind)).toEqual(['attachment', 'text', 'omitted'])
  })

  it('drops reply copies from the meta and turns legacy Codex items into content', () => {
    const message = reply('final', {
      status: 'complete',
      metadata: { resultText: 'final', codex: { items: [{ id: 'm1', type: 'agent_message', text: 'from item' }], finalResponse: 'final' } as never },
    })
    const result = fragmentMessage(message)
    expect(result.meta.metadata).not.toHaveProperty('resultText')
    expect(result.meta.metadata?.codex).toEqual({ items: [] })
    expect(result.fragments.some((f) => f.body.kind === 'text' && f.body.text.includes('from item'))).toBe(true)
  })
})
