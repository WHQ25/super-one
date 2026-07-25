import { describe, it, expect } from 'vitest'
import type { ContentBlock } from './agent-types'
import { applyContentDelta, mergeToolUseInputJson } from './content-delta'

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

describe('applyContentDelta: tool_use input merge', () => {
  it('preserves query when a later sparse update omits it', () => {
    let content: ContentBlock[] = []
    content = applyContentDelta(content, {
      type: 'tool_use',
      toolUseId: 'ws1',
      toolName: 'WebSearch',
      input: JSON.stringify({ query: 'agent client protocol', variant: 'WebSearch' }),
      toolSummary: 'agent client protocol',
      status: 'streaming',
    } as ContentBlock)
    content = applyContentDelta(content, {
      type: 'tool_use',
      toolUseId: 'ws1',
      toolName: 'WebSearch',
      input: JSON.stringify({ variant: 'WebSearch', backend: true }),
      toolSummary: 'Web search:',
      status: 'complete',
    } as ContentBlock)
    const block = content[0]
    expect(block.type).toBe('tool_use')
    if (block.type === 'tool_use') {
      expect(JSON.parse(block.input)).toMatchObject({ query: 'agent client protocol', backend: true })
      expect(block.toolSummary).toBe('agent client protocol')
      expect(block.status).toBe('complete')
    }
  })

  it('upgrades toolSummary from raw_output backfill query', () => {
    let content: ContentBlock[] = []
    content = applyContentDelta(content, {
      type: 'tool_use',
      toolUseId: 'ws2',
      toolName: 'WebSearch',
      input: JSON.stringify({ variant: 'WebSearch', backend: true }),
      toolSummary: 'Web search:',
      status: 'streaming',
    } as ContentBlock)
    content = applyContentDelta(content, {
      type: 'tool_use',
      toolUseId: 'ws2',
      toolName: 'WebSearch',
      input: JSON.stringify({ query: 'from raw_output' }),
      toolSummary: 'from raw_output',
      status: 'complete',
    } as ContentBlock)
    const block = content[0]
    expect(block.type).toBe('tool_use')
    if (block.type === 'tool_use') {
      expect(JSON.parse(block.input)).toMatchObject({ query: 'from raw_output', backend: true })
      expect(block.toolSummary).toBe('from raw_output')
    }
  })
})

describe('mergeToolUseInputJson', () => {
  it('keeps pattern when next payload drops it', () => {
    const merged = mergeToolUseInputJson(
      JSON.stringify({ pattern: 'foo', path: 'src' }),
      JSON.stringify({ path: 'src', head_limit: 10 }),
    )
    expect(JSON.parse(merged as string)).toEqual({ pattern: 'foo', path: 'src', head_limit: 10 })
  })
})
