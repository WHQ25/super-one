import { describe, expect, it } from 'vitest'
import { createDeadStreamLedger } from './dead-stream-ledger'
import { applyContentDelta, retractContentBlocks } from './content-delta'
import type { ContentBlock } from './agent-types'

describe('createDeadStreamLedger', () => {
  it('never removes an older confirmed repeat when the newest suffix does not match', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: 'repeat' },
      { type: 'tool_use', toolUseId: 'tool', toolName: 'Read', input: '{}' },
      { type: 'text', text: 'newer confirmed text' },
    ]
    expect(retractContentBlocks(content, [{ type: 'text', text: 'repeat', fromEnd: true }])).toEqual(content)
  })

  it.each(['text', 'thinking'] as const)('retracts only the failed %s suffix after confirmed content', (type) => {
    const ledger = createDeadStreamLedger()
    const block = (value: string): ContentBlock => type === 'text'
      ? { type, text: value } : { type, thinking: value }
    const announce = (value: string) => type === 'text'
      ? ledger.announceText(null, 'm1', value) : ledger.announceThinking(null, 'm1', value)
    ledger.begin(null, 'm1')
    announce('Confirmed. ')
    let content = applyContentDelta([], block('Confirmed. '))
    ledger.confirm(null, [block('Confirmed. ')])
    ledger.begin(null, 'm1')
    announce('Ghost partial')
    content = applyContentDelta(content, block('Ghost partial'))
    for (const event of ledger.begin(null, 'm1')) {
      if (event.type === 'content_retracted') content = retractContentBlocks(content, event.blocks)
    }
    expect(content).toEqual([block('Confirmed. ')])
    content = applyContentDelta(content, block('Retry.'))
    expect(content).toEqual([block('Confirmed. Retry.')])
  })

  it('evicts nothing when every announced block was confirmed by an assistant frame', () => {
    const ledger = createDeadStreamLedger()
    ledger.begin(null, 'm1')
    ledger.announceThinking(null, 'm1', 'plan')
    ledger.announceToolUse(null, 'm1', 'tu-1')
    ledger.confirm(null, [{ type: 'thinking', thinking: 'plan' }, { type: 'tool_use', id: 'tu-1' }])

    expect(ledger.begin(null, 'm1')).toEqual([])
    expect(ledger.flush()).toEqual([])
  })

  it('evicts the unconfirmed blocks of the previous attempt when the same scope starts a new one', () => {
    const ledger = createDeadStreamLedger()
    ledger.begin(null, 'm1')
    ledger.announceThinking(null, 'm1', 'half a ')
    ledger.announceThinking(null, 'm1', 'thought')
    ledger.announceText(null, 'm1', 'partial')
    ledger.announceToolUse(null, 'm1', 'tu-dead')

    expect(ledger.begin(null, 'm1')).toEqual([{
      type: 'content_retracted',
      messageId: 'm1',
      blocks: [
        { type: 'tool_use', toolUseId: 'tu-dead' },
        { type: 'text', text: 'partial', fromEnd: true },
        { type: 'thinking', thinking: 'half a thought', fromEnd: true },
      ],
    }])
    // The retry starts clean.
    expect(ledger.flush()).toEqual([])
  })

  it('confirming a text block resets the accumulator so a later text block is tracked on its own', () => {
    const ledger = createDeadStreamLedger()
    ledger.begin(null, 'm1')
    ledger.announceText(null, 'm1', 'first')
    ledger.confirm(null, [{ type: 'text', text: 'first' }])
    ledger.announceText(null, 'm1', 'second')

    expect(ledger.flush()).toEqual([
      { type: 'content_retracted', messageId: 'm1', blocks: [{ type: 'text', text: 'second', fromEnd: true }] },
    ])
  })

  it('keeps scopes independent and tracks only tool ids below top level', () => {
    const ledger = createDeadStreamLedger()
    ledger.begin(null, 'm1')
    ledger.announceToolUse(null, 'm1', 'tu-main')
    ledger.begin('agent-1', 'm1')
    ledger.announceText('agent-1', 'm1', 'nested text is not retractable')
    ledger.announceToolUse('agent-1', 'm1', 'tu-nested')

    // The subagent retries; the main model's in-flight attempt is untouched.
    expect(ledger.begin('agent-1', 'm1')).toEqual([
      { type: 'content_retracted', messageId: 'm1', blocks: [{ type: 'tool_use', toolUseId: 'tu-nested' }] },
    ])
    ledger.confirm(null, [{ type: 'tool_use', id: 'tu-main' }])
    expect(ledger.flush()).toEqual([])
  })

  it('flush evicts every scope still unconfirmed and forgets them', () => {
    const ledger = createDeadStreamLedger()
    ledger.begin(null, 'm1')
    ledger.announceToolUse(null, 'm1', 'tu-main')
    ledger.begin('agent-1', 'm1')
    ledger.announceToolUse('agent-1', 'm1', 'tu-nested')

    expect(ledger.flush()).toEqual([
      { type: 'content_retracted', messageId: 'm1', blocks: [{ type: 'tool_use', toolUseId: 'tu-main' }] },
      { type: 'content_retracted', messageId: 'm1', blocks: [{ type: 'tool_use', toolUseId: 'tu-nested' }] },
    ])
    expect(ledger.flush()).toEqual([])
  })
})
