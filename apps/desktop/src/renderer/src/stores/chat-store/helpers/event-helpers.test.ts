import { describe, it, expect } from 'vitest'
import type { ContentBlock } from '@superone/shared/agent-types'
import { applyDelta } from './event-helpers'

const thinking = (text: string, parent?: string | null): ContentBlock =>
  ({ type: 'thinking', thinking: text, ...(parent !== undefined ? { parentToolUseId: parent } : {}) }) as ContentBlock
const text = (t: string, parent?: string | null): ContentBlock =>
  ({ type: 'text', text: t, ...(parent !== undefined ? { parentToolUseId: parent } : {}) }) as ContentBlock

describe('applyDelta: thinking/text stream merging by parent', () => {
  it('merges consecutive top-level thinking deltas into one block', () => {
    let content: ContentBlock[] = []
    content = applyDelta(content, thinking('The '))
    content = applyDelta(content, thinking('bash output is empty.'))
    expect(content).toHaveLength(1)
    expect((content[0] as { thinking: string }).thinking).toBe('The bash output is empty.')
  })

  it('keeps merging top-level thinking even when a subagent block interleaves', () => {
    let content: ContentBlock[] = []
    content = applyDelta(content, thinking(" bash commands aren't producing output, so I'll wait", null))
    content = applyDelta(content, text('Great! I found the recent commit.', 'toolu_subagent'))
    content = applyDelta(content, thinking(' and try running them again.', null))

    const topThinking = content.filter((b) => b.type === 'thinking')
    expect(topThinking).toHaveLength(1)
    expect((topThinking[0] as { thinking: string }).thinking).toBe(
      " bash commands aren't producing output, so I'll wait and try running them again.",
    )
    expect(content.some((b) => b.type === 'text')).toBe(true)
  })

  it('keeps merging a thinking block interrupted by an async tool_result', () => {
    let content: ContentBlock[] = []
    content = applyDelta(content, { type: 'tool_use', toolName: 'Read', toolUseId: 'r1', input: '{}', parentToolUseId: null } as ContentBlock)
    content = applyDelta(content, thinking(' The', null))
    content = applyDelta(content, { type: 'tool_result', toolUseId: 'r1', summary: 'file body' } as ContentBlock)
    content = applyDelta(content, thinking(' workflow completed and returned 16 findings.', null))

    const th = content.filter((b) => b.type === 'thinking')
    expect(th).toHaveLength(1)
    expect((th[0] as { thinking: string }).thinking).toBe(' The workflow completed and returned 16 findings.')
    expect(content.some((b) => b.type === 'tool_result')).toBe(true)
  })

  it('does NOT merge top-level thinking across the same agent\'s own tool call', () => {
    let content: ContentBlock[] = []
    content = applyDelta(content, thinking('Let me check the file.', null))
    content = applyDelta(content, { type: 'tool_use', toolName: 'Bash', toolUseId: 't1', input: '{}', parentToolUseId: null } as ContentBlock)
    content = applyDelta(content, thinking('The output is empty.', null))
    expect(content.filter((b) => b.type === 'thinking')).toHaveLength(2)
  })

  it('merges a subagent thinking stream interrupted by a different parent block', () => {
    let content: ContentBlock[] = []
    content = applyDelta(content, thinking('Subagent reasoning part one', 'toolu_sub'))
    content = applyDelta(content, thinking('Top-level reasoning', null))
    content = applyDelta(content, thinking(' part two', 'toolu_sub'))

    const sub = content.filter((b) => b.type === 'thinking' && (b as { parentToolUseId?: string }).parentToolUseId === 'toolu_sub')
    expect(sub).toHaveLength(1)
    expect((sub[0] as { thinking: string }).thinking).toBe('Subagent reasoning part one part two')
  })

  it('merges interleaved top-level text deltas the same way', () => {
    let content: ContentBlock[] = []
    content = applyDelta(content, text('Hello ', null))
    content = applyDelta(content, text('subagent note', 'toolu_sub'))
    content = applyDelta(content, text('world', null))
    const top = content.filter((b) => b.type === 'text' && (b as { parentToolUseId?: string | null }).parentToolUseId === null)
    expect(top).toHaveLength(1)
    expect((top[0] as { text: string }).text).toBe('Hello world')
  })

  it('carries the run start and advances the end across merged thinking deltas', () => {
    const stamped = (text: string, startedAt?: number, endedAt?: number): ContentBlock =>
      ({ type: 'thinking', thinking: text, parentToolUseId: null, startedAt, endedAt }) as ContentBlock
    let content: ContentBlock[] = []
    content = applyDelta(content, stamped('', 1000, 1000))
    content = applyDelta(content, stamped('reasoning', undefined, 4000))
    content = applyDelta(content, stamped('…', undefined, 6000))
    expect(content).toHaveLength(1)
    const block = content[0] as { startedAt?: number; endedAt?: number }
    expect(block.startedAt).toBe(1000)
    expect(block.endedAt).toBe(6000)
  })
})
