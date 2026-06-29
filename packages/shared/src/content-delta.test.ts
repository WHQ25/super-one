import { describe, it, expect } from 'vitest'
import type { ContentBlock } from './agent-types'
import { applyContentDelta } from './content-delta'

const thinking = (text: string, parent?: string | null): ContentBlock =>
  ({ type: 'thinking', thinking: text, ...(parent !== undefined ? { parentToolUseId: parent } : {}) }) as ContentBlock
const text = (t: string, parent?: string | null): ContentBlock =>
  ({ type: 'text', text: t, ...(parent !== undefined ? { parentToolUseId: parent } : {}) }) as ContentBlock

describe('applyContentDelta: never merges across parentToolUseId', () => {
  it('keeps a subagent text stream out of the main agent block', () => {
    let content: ContentBlock[] = []
    content = applyContentDelta(content, text('Hello ', null))
    content = applyContentDelta(content, text('subagent note', 'toolu_sub'))
    content = applyContentDelta(content, text('world', null))
    const top = content.filter((b) => b.type === 'text' && (b as { parentToolUseId?: string | null }).parentToolUseId === null)
    const sub = content.filter((b) => b.type === 'text' && (b as { parentToolUseId?: string }).parentToolUseId === 'toolu_sub')
    expect(top).toHaveLength(1)
    expect((top[0] as { text: string }).text).toBe('Hello world')
    expect(sub).toHaveLength(1)
    expect((sub[0] as { text: string }).text).toBe('subagent note')
  })

  it('preserves parentToolUseId on a merged subagent text block', () => {
    let content: ContentBlock[] = []
    content = applyContentDelta(content, text('part one ', 'toolu_sub'))
    content = applyContentDelta(content, text('part two', 'toolu_sub'))
    expect(content).toHaveLength(1)
    expect((content[0] as { parentToolUseId?: string }).parentToolUseId).toBe('toolu_sub')
    expect((content[0] as { text: string }).text).toBe('part one part two')
  })

  it('merges two parallel subagent thinking streams independently', () => {
    let content: ContentBlock[] = []
    content = applyContentDelta(content, thinking('A reasoning ', 'toolu_a'))
    content = applyContentDelta(content, thinking('B reasoning ', 'toolu_b'))
    content = applyContentDelta(content, thinking('continues', 'toolu_a'))
    const a = content.filter((b) => b.type === 'thinking' && (b as { parentToolUseId?: string }).parentToolUseId === 'toolu_a')
    const b = content.filter((b) => b.type === 'thinking' && (b as { parentToolUseId?: string }).parentToolUseId === 'toolu_b')
    expect(a).toHaveLength(1)
    expect((a[0] as { thinking: string }).thinking).toBe('A reasoning continues')
    expect(b).toHaveLength(1)
    expect((b[0] as { thinking: string }).thinking).toBe('B reasoning ')
  })
})
