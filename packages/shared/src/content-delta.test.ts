import { describe, it, expect } from 'vitest'
import type { CodexThreadItem, ContentBlock } from './agent-types'
import { applyContentDelta, mergeToolUseInputJson, sealCodexItems } from './content-delta'

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
  it('uses the injected clock when a tool starts', () => {
    const content = applyContentDelta([], {
      type: 'tool_use',
      toolUseId: 'clocked',
      toolName: 'Read',
      input: '{}',
      status: 'streaming',
    } as ContentBlock, () => 1_700_000_000_000)

    expect(content[0]).toMatchObject({
      type: 'tool_use',
      toolUseId: 'clocked',
      startedAt: 1_700_000_000_000,
    })
  })

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

describe('sealCodexItems', () => {
  const mcpCall = (id: string, status: string): CodexThreadItem =>
    ({ id, type: 'mcp_tool_call', server: 'superone', tool: 'computer_act', status }) as unknown as CodexThreadItem

  it('seals an mcp_tool_call left in_progress when the turn was interrupted', () => {
    const sealed = sealCodexItems([mcpCall('i1', 'completed'), mcpCall('i2', 'in_progress')])
    expect(sealed[1].status).toBe('completed')
    expect(sealed[0].status).toBe('completed')
  })

  it('returns the same array ref when nothing was in flight', () => {
    const items = [mcpCall('i1', 'completed'), mcpCall('i2', 'failed')]
    expect(sealCodexItems(items)).toBe(items)
  })

  it('leaves media generation alone — a render outlives the turn that started it', () => {
    const items = [
      { id: 'v1', type: 'video_generation', status: 'in_progress' },
      { id: 'g1', type: 'image_generation', status: 'in_progress' },
    ] as unknown as CodexThreadItem[]
    expect(sealCodexItems(items)).toBe(items)
  })

  it('seals collab child items too — a nested agent row shimmers on its own', () => {
    const items = [{
      id: 'c1',
      type: 'collab_tool_call',
      tool: 'spawnAgent',
      status: 'in_progress',
      receiverThreadIds: [],
      agentsStates: {},
      childItems: { t1: [mcpCall('n1', 'in_progress')] },
    }] as unknown as CodexThreadItem[]
    const sealed = sealCodexItems(items)
    expect(sealed[0].status).toBe('completed')
    const child = (sealed[0] as unknown as { childItems: Record<string, CodexThreadItem[]> }).childItems.t1[0]
    expect(child.status).toBe('completed')
  })
})
