import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage, CodexThreadItem, ContentBlock } from '@superone/shared/agent-types'
import { SimulatedStream } from './simulated-stream'

function message(text: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'reply', role: 'assistant', status: 'streaming', providerId: 'claude',
    createdAt: '2026-09-08T00:00:00Z', content: [{ type: 'text', text }], ...overrides,
  }
}
function text(stream: SimulatedStream, index = 0): string {
  const block = stream.messages[0].content[index]
  return block.type === 'text' ? block.text : block.type === 'thinking' ? block.thinking : ''
}
function codex(items: CodexThreadItem[], overrides: Partial<ChatMessage> = {}): ChatMessage {
  return message('', { providerId: 'codex', content: [], metadata: { codex: { items, usage: null, threadId: 'thread' } }, ...overrides })
}
function codexTexts(stream: SimulatedStream): string[] {
  return stream.messages[0].metadata!.codex!.items.map((item) => 'text' in item ? item.text : '')
}

describe('mobile simulated stream', () => {
  it('shows hydration and unchanged history immediately, preserving stable references', () => {
    const stream = new SimulatedStream()
    const history = [message('Historical reply', { status: 'complete' })]
    stream.reset(history)
    stream.advance(10_000)
    stream.update(history, 10_000)
    expect(stream.messages).toBe(history)
    expect(stream.pending).toBe(false)
    stream.update([{ ...history[0] }], 10_100)
    expect(text(stream)).toBe('Historical reply')
    expect(stream.pending).toBe(false)
  })

  it('reveals a newly received complete reply without changing source or status', () => {
    const stream = new SimulatedStream()
    const source = message('Hello', { status: 'complete' })
    stream.update([source], 0)
    expect(text(stream)).toBe('')
    expect(stream.messages[0].status).toBe('complete')
    const initial = stream.messages
    const revealing = stream.revealingIds
    stream.advance(5)
    expect(stream.messages).toBe(initial)
    stream.advance(20)
    expect(text(stream)).toBe('He')
    expect(source.content).toEqual([{ type: 'text', text: 'Hello' }])
    stream.advance(50)
    expect(stream.messages[0]).toBe(source)
    expect(stream.pending).toBe(false)
    expect(revealing.has('reply')).toBe(true)
    expect(stream.revealingIds.has('reply')).toBe(false)
  })

  it('plays thinking then prose then fenced code in order while tools and users appear immediately', () => {
    const stream = new SimulatedStream()
    const tool: ContentBlock = { type: 'tool_result', toolUseId: 'tool', summary: 'Ready' }
    const source = message('', { content: [
      { type: 'thinking', thinking: '想法', endedAt: 20 },
      tool, { type: 'text', text: 'OK' }, { type: 'text', text: '```js\nx()\n```' },
    ] })
    const user = message('Question', { id: 'user', role: 'user' })
    stream.update([source, user], 0)
    expect(stream.revealingReasoningIds).toEqual(new Set(['reply']))
    expect(stream.messages[0].content[1]).toBe(tool)
    expect(stream.messages[1]).toBe(user)
    stream.advance(15)
    expect(text(stream)).toBe('想')
    expect(text(stream, 2)).toBe('')
    stream.advance(40)
    expect(stream.revealingReasoningIds.size).toBe(0)
    expect(stream.revealingIds.has('reply')).toBe(true)
    expect(text(stream)).toBe('想法')
    expect(text(stream, 2)).toBe('O')
    expect(text(stream, 3)).toBe('')
    stream.advance(70)
    expect(text(stream, 2)).toBe('OK')
    expect(text(stream, 3)).toBe('``')
    expect(stream.messages[0].content[0]).toMatchObject({ endedAt: 20 })
  })

  it('continues appended chunks without restarting the revealed prefix', () => {
    const stream = new SimulatedStream()
    stream.update([message('abcd')], 0)
    stream.advance(20)
    stream.update([message('abcdefgh')], 20)
    expect(text(stream)).toBe('ab')
    stream.advance(40)
    expect(text(stream)).toBe('abcd')
    stream.advance(80)
    expect(text(stream)).toBe('abcdefgh')
    stream.update([message('abcdefghij')], 100)
    expect(text(stream)).toBe('abcdefgh')
    stream.advance(110)
    expect(text(stream)).toBe('abcdefghi')
  })

  it('appends to hydrated text without replaying it', () => {
    const stream = new SimulatedStream()
    stream.reset([message('Already here')])
    stream.update([message('Already here now')], 0)
    expect(text(stream)).toBe('Already here')
    stream.advance(20)
    expect(text(stream)).toBe('Already here n')
  })

  it('finishes large backlogs within five seconds, including late appends', () => {
    const stream = new SimulatedStream()
    stream.update([message('a'.repeat(2_000))], 0)
    stream.advance(2_500)
    expect(text(stream).length).toBe(1_000)
    stream.update([message('a'.repeat(4_000))], 2_500)
    stream.advance(5_000)
    expect(text(stream).length).toBe(4_000)
    expect(stream.pending).toBe(false)
  })

  it('schedules the last frame at the five-second deadline and drains fractional budgets', () => {
    const stream = new SimulatedStream()
    stream.update([message('中abc'.repeat(347))], 0)
    for (let now = 33; now <= 4_983; now += 33) stream.advance(now)
    expect(stream.nextDelayMs(4_983)).toBe(17)
    stream.advance(5_000)
    expect(stream.pending).toBe(false)
    expect(stream.nextDelayMs(5_000)).toBe(0)
    expect(text(stream)).toBe('中abc'.repeat(347))
  })

  it('synchronizes replacement and shortened text immediately', () => {
    const stream = new SimulatedStream()
    stream.update([message('Unfinished original')], 0)
    stream.advance(30)
    stream.update([message('Replacement')], 30)
    expect(text(stream)).toBe('Replacement')
    expect(stream.pending).toBe(false)
    stream.update([message('Replace')], 40)
    expect(text(stream)).toBe('Replace')
    expect(stream.pending).toBe(false)
  })

  it.each(['interrupted', 'error'] as const)('flushes immediately on %s', (status) => {
    const stream = new SimulatedStream()
    stream.update([message('Still animating')], 0)
    const stopped = message('Still animating', { status })
    stream.update([stopped], 20)
    expect(stream.messages[0]).toBe(stopped)
    expect(stream.pending).toBe(false)
  })

  it('cancels deleted messages and clears the queue on reset', () => {
    const stream = new SimulatedStream()
    stream.update([message('Removed')], 0)
    stream.update([], 10)
    expect(stream.pending).toBe(false)
    stream.advance(100)
    expect(stream.messages).toEqual([])
    stream.update([message('Reset')], 100)
    stream.reset([message('Restored')])
    expect(text(stream)).toBe('Restored')
    expect(stream.pending).toBe(false)
    expect(stream.revealingReasoningIds.size).toBe(0)
  })

  it('prepends deduplicated history without disturbing an active reply', () => {
    const stream = new SimulatedStream()
    stream.update([message('abcdef')], 0)
    stream.advance(20)
    const older = message('History', { id: 'old', status: 'complete' })
    stream.prepend([older, older, message('Stale overlap')])
    expect(stream.messages.map((item) => item.id)).toEqual(['old', 'reply'])
    expect(stream.messages[0]).toBe(older)
    stream.advance(40)
    expect(stream.messages[1].content).toEqual([{ type: 'text', text: 'abcd' }])
    expect(stream.revealingIds).toEqual(new Set(['reply']))
  })

  it('reveals Codex reasoning, plan and agent messages in item order', () => {
    const stream = new SimulatedStream()
    const items: CodexThreadItem[] = [
      { id: 'r', type: 'reasoning', text: '思考', endedAt: 30 },
      { id: 'p', type: 'plan', text: 'Plan' },
      { id: 'a', type: 'agent_message', text: 'Answer' },
    ]
    const source = codex(items)
    stream.update([source], 0)
    const reasoningIds = stream.revealingReasoningIds
    expect(reasoningIds.has('reply')).toBe(true)
    stream.advance(40)
    expect(stream.revealingReasoningIds.size).toBe(0)
    expect(reasoningIds.has('reply')).toBe(true)
    expect(codexTexts(stream)).toEqual(['思考', 'P', ''])
    expect(items[1]).toMatchObject({ text: 'Plan' })
    stream.advance(80)
    expect(codexTexts(stream)).toEqual(['思考', 'Plan', 'A'])
    stream.advance(130)
    expect(stream.messages[0]).toBe(source)
  })

  it.each(['agent_message', 'plan'] as const)('does not spend time on the hidden Codex content copy with %s', (type) => {
    const stream = new SimulatedStream()
    const source = codex([{ id: 'answer', type, text: 'Answer' }], {
      content: [{ type: 'text', text: 'Answer' }], status: 'complete',
    })
    stream.update([source], 0)
    stream.advance(10)
    expect(codexTexts(stream)).toEqual(['A'])
    expect(stream.messages[0].content).toBe(source.content)
    stream.advance(60)
    expect(stream.pending).toBe(false)
  })

  it('reveals Codex fallback content after reasoning when no answer item exists', () => {
    const stream = new SimulatedStream()
    stream.update([codex([{ id: 'reason', type: 'reasoning', text: '思考' }], {
      content: [{ type: 'thinking', thinking: 'Hidden duplicate' }, { type: 'text', text: 'Fallback' }],
    })], 0)
    stream.advance(40)
    expect(codexTexts(stream)).toEqual(['思考'])
    expect(text(stream, 1)).toBe('F')
  })

  it('keeps Unicode graphemes whole and joins combining marks across chunks', () => {
    const stream = new SimulatedStream()
    const units = ['e\u0301', '👨‍👩‍👧‍👦', '🇨🇳', '👍🏽', '中']
    stream.update([message(units.join(''))], 0)
    for (let count = 1; count <= 4; count++) {
      stream.advance(count * 10)
      expect(text(stream)).toBe(units.slice(0, count).join(''))
    }
    stream.advance(55)
    expect(text(stream)).toBe(units.join(''))
    stream.reset([message('e')])
    stream.update([message('e\u0301x')], 60)
    expect(text(stream)).toBe('e\u0301')
    stream.advance(70)
    expect(text(stream)).toBe('e\u0301x')
  })

  it('uses safe grapheme fallback without Intl.Segmenter', () => {
    vi.stubGlobal('Intl', Object.assign(Object.create(Intl), { Segmenter: undefined }))
    try {
      const stream = new SimulatedStream()
      stream.update([message('👨‍👩‍👧‍👦🇨🇳e\u0301')], 0)
      stream.advance(10)
      expect(text(stream)).toBe('👨‍👩‍👧‍👦')
      stream.advance(20)
      expect(text(stream)).toBe('👨‍👩‍👧‍👦🇨🇳')
    } finally { vi.unstubAllGlobals() }
  })

  it('shows system markers and tool-only updates immediately', () => {
    const stream = new SimulatedStream()
    const system = message('__compact__:auto:100', { providerId: 'system' })
    stream.update([system], 0)
    expect(stream.messages[0]).toBe(system)
    expect(stream.pending).toBe(false)
  })

  it('segments appended text only at updates, never on animation frames', () => {
    const spy = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      const stream = new SimulatedStream()
      stream.update([message('a'.repeat(1_000))], 0)
      const calls = spy.mock.calls.length
      for (let now = 33; now < 2_000; now += 33) stream.advance(now)
      expect(spy.mock.calls.length).toBe(calls)
    } finally { spy.mockRestore() }
  })
})
