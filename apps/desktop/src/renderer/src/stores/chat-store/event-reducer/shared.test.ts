import { describe, it, expect } from 'vitest'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { _patchAgentBlock, mapMessagesStructural } from './shared'

function toolUse(toolUseId: string, toolName: string, extra: Record<string, unknown> = {}): ContentBlock {
  return { type: 'tool_use', toolUseId, toolName, input: '', ...extra } as ContentBlock
}

function makeMsg(id: string, blocks: ContentBlock[]): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    content: blocks,
    createdAt: '',
    providerId: 'claude',
  }
}

describe('mapMessagesStructural', () => {
  it('returns the same messages array when no block changes', () => {
    const m0 = makeMsg('m0', [toolUse('t0', 'Read')])
    const m1 = makeMsg('m1', [toolUse('t1', 'Bash')])
    const messages = [m0, m1]
    const next = mapMessagesStructural(messages, (block) => block)
    expect(next).toBe(messages)
    expect(next[0]).toBe(m0)
    expect(next[1]).toBe(m1)
  })

  it('keeps non-target message and block refs when one block is patched', () => {
    const otherBlock = toolUse('t-other', 'Read')
    const targetBlock = toolUse('t-target', 'Agent')
    const m0 = makeMsg('m0', [otherBlock])
    const m1 = makeMsg('m1', [targetBlock])
    const m2 = makeMsg('m2', [toolUse('t2', 'Bash')])
    const messages = [m0, m1, m2]

    const next = mapMessagesStructural(messages, (block) => {
      if (block.type === 'tool_use' && block.toolUseId === 't-target') {
        return { ...block, taskSummary: 'done' }
      }
      return block
    })

    expect(next).not.toBe(messages)
    expect(next[0]).toBe(m0)
    expect(next[0].content[0]).toBe(otherBlock)
    expect(next[2]).toBe(m2)
    expect(next[1]).not.toBe(m1)
    expect(next[1].content[0]).not.toBe(targetBlock)
    expect((next[1].content[0] as { taskSummary?: string }).taskSummary).toBe('done')
  })
})

describe('_patchAgentBlock', () => {
  it('preserves non-home message identities', () => {
    const homeBlock = toolUse('agent-1', 'Agent')
    const otherBlock = toolUse('agent-2', 'Agent')
    const mHome = makeMsg('home', [homeBlock])
    const mOther = makeMsg('other', [otherBlock])
    const mUser = makeMsg('user', [{ type: 'text', text: 'hi' }])
    // user messages use role user in production; identity share is what we assert
    const messages = [mUser, mOther, mHome]

    const next = _patchAgentBlock(messages, 'agent-1', {
      taskUsage: { totalTokens: 10, toolUses: 2, durationMs: 100 },
      taskSummary: 'working',
    })

    expect(next[0]).toBe(mUser)
    expect(next[1]).toBe(mOther)
    expect(next[1].content[0]).toBe(otherBlock)
    expect(next[2]).not.toBe(mHome)
    expect((next[2].content[0] as { taskSummary?: string }).taskSummary).toBe('working')
    expect((next[2].content[0] as { taskUsage?: { totalTokens: number } }).taskUsage?.totalTokens).toBe(10)
  })

  it('returns the same array when no Agent toolUseId matches', () => {
    const m0 = makeMsg('m0', [toolUse('x', 'Agent')])
    const messages = [m0]
    const next = _patchAgentBlock(messages, 'missing', { taskSummary: 'nope' })
    expect(next).toBe(messages)
    expect(next[0]).toBe(m0)
  })
})
