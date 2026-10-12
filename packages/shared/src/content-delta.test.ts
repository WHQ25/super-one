import { describe, it, expect } from 'vitest'
import type { CodexThreadItem, ContentBlock } from './agent-types'
import { applyContentDelta, mergeToolUseInputJson, retractContentBlocks, sealCodexItems, sealStreamingTools } from './content-delta'

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

/**
 * The remote projection sent to the phone rewrites a Bash `tool_result` into
 * `bash_result` (command echo + pre-tokenised ANSI) and a Todo one into
 * `todo_result`, and types the CALL by its tool (`bash`) instead of `tool_use`.
 * Matching only the desktop shapes left the row shimmering "Running…" forever
 * with its output nowhere on screen.
 */
describe('applyContentDelta: projected result blocks seal their call', () => {
  const bashCall: ContentBlock = {
    type: 'bash', toolName: 'Bash', toolUseId: 'bash-1', status: 'streaming',
    input: JSON.stringify({ command: 'ls -la' }),
  } as ContentBlock

  it('completes a projected bash call when its bash_result lands', () => {
    const result = { type: 'bash_result', toolUseId: 'bash-1', summary: '$ ls -la\nfoo.ts' } as ContentBlock
    const content = applyContentDelta([bashCall], result)

    expect(content).toHaveLength(2)
    expect((content[0] as { status?: string }).status).toBe('complete')
  })

  it('completes a projected todo call when its todo_result lands', () => {
    const call = { ...bashCall, toolName: 'TodoWrite', toolUseId: 'todo-1', type: 'tool_use' } as ContentBlock
    const result = { type: 'todo_result', toolUseId: 'todo-1', summary: 'ok', toolTodos: [] } as ContentBlock

    expect((applyContentDelta([call], result)[0] as { status?: string }).status).toBe('complete')
  })

  it('leaves an unrelated call streaming', () => {
    const other = { ...bashCall, toolUseId: 'bash-2' } as ContentBlock
    const result = { type: 'bash_result', toolUseId: 'bash-1', summary: 'done' } as ContentBlock

    expect((applyContentDelta([other], result)[0] as { status?: string }).status).toBe('streaming')
  })

  it('does not treat a projected result as a boundary for the block it interleaves', () => {
    // A Bash result arrives asynchronously and can land between two deltas of the
    // SAME thinking block. Its call is already in the turn and is the real
    // boundary, so the result must be skipped — the exemption `tool_result` has.
    const content = [
      bashCall,
      { type: 'thinking', thinking: 'Reading the ' } as ContentBlock,
      { type: 'bash_result', toolUseId: 'bash-1', summary: 'done' } as ContentBlock,
      { type: 'thinking', thinking: 'listing.' } as ContentBlock,
    ].reduce<ContentBlock[]>((acc, delta) => applyContentDelta(acc, delta), [])

    const thoughts = content.filter((b) => b.type === 'thinking')
    expect(thoughts).toHaveLength(1)
    expect((thoughts[0] as { thinking: string }).thinking).toBe('Reading the listing.')
  })

  it('treats a call-less result as a boundary, because nothing else can be one', () => {
    // The projection drops the TodoWrite call and forwards only `todo_result`,
    // so exempting it merged the agent's narration around six todo updates into
    // one paragraph, printed above every list it was describing.
    const content = applyContentDelta(
      applyContentDelta(
        [{ type: 'text', text: 'Step one.' } as ContentBlock],
        { type: 'todo_result', toolUseId: 'todo-1', summary: 'ok' } as ContentBlock,
      ),
      { type: 'text', text: 'Step two.' } as ContentBlock,
    )

    expect(content.filter((b) => b.type === 'text')).toHaveLength(2)
  })
})

/**
 * The same projection types the CALL by its tool name (`bash`, `read`, `edit`, …).
 * Claude opens a tool block with an empty input and fills it in a second delta,
 * so a reducer that only merges `type === 'tool_use'` appends both: the phone
 * drew the command twice, once as an empty summary row and once with the real
 * command.
 */
describe('applyContentDelta: projected tool calls merge by toolUseId', () => {
  const open = (type: string): ContentBlock =>
    ({ type, toolName: 'Bash', toolUseId: 'bash-1', input: '', status: 'streaming' }) as ContentBlock
  const filled = (type: string): ContentBlock =>
    ({ type, toolName: 'Bash', toolUseId: 'bash-1', status: 'streaming',
      input: JSON.stringify({ command: 'ls -la' }), toolSummary: 'ls -la' }) as ContentBlock

  it('merges the opening and filled deltas of a projected bash call', () => {
    const content = applyContentDelta(applyContentDelta([], open('bash')), filled('bash'))

    expect(content).toHaveLength(1)
    expect((content[0] as { input: string }).input).toContain('ls -la')
    expect((content[0] as { type: string }).type).toBe('bash')
  })

  it('keeps the desktop tool_use shape merging as before', () => {
    const content = applyContentDelta(applyContentDelta([], open('tool_use')), filled('tool_use'))

    expect(content).toHaveLength(1)
    expect((content[0] as { input: string }).input).toContain('ls -la')
  })

  it('still appends a different projected call', () => {
    const other = { ...(filled('read') as object), toolName: 'Read', toolUseId: 'read-1' } as ContentBlock
    const content = applyContentDelta(applyContentDelta([], open('bash')), other)

    expect(content).toHaveLength(2)
  })

  it('seals a projected call left streaming by an interrupt', () => {
    const sealed = sealStreamingTools([open('bash')])

    expect((sealed[0] as { status?: string }).status).toBe('complete')
  })
})

describe('retractContentBlocks', () => {
  const toolUse = (id: string): ContentBlock => ({ type: 'tool_use', toolName: 'Bash', toolUseId: id, input: '{}', status: 'complete' })
  const toolResult = (id: string): ContentBlock => ({ type: 'tool_result', toolUseId: id, summary: 'ok' })
  const work = [thinking('plan'), toolUse('tu_1'), toolResult('tu_1')]

  it('drops a refused partial by exact payload and keeps the earlier work', () => {
    const content = [...work, text('I can help with')]
    expect(retractContentBlocks(content, [{ type: 'text', text: 'I can help with' }])).toEqual(work)
  })

  it('drops a retracted tool call together with its result', () => {
    const content = [text('a'), toolUse('tu_1'), toolResult('tu_1'), toolUse('tu_2'), toolResult('tu_2')]
    expect(retractContentBlocks(content, [{ type: 'tool_use', toolUseId: 'tu_2' }])).toEqual(content.slice(0, 3))
  })

  it('drops only the result for a tombstoned tool_result frame', () => {
    const content = [toolUse('tu_1'), toolResult('tu_1')]
    expect(retractContentBlocks(content, [{ type: 'tool_result', toolUseId: 'tu_1' }])).toEqual([toolUse('tu_1')])
  })

  it('strips just the refused prefix when the retry already merged onto it', () => {
    const merged = [...work, text('I can help with' + 'Sure, here is')]
    expect(retractContentBlocks(merged, [{ type: 'text', text: 'I can help with' }])).toEqual([...work, text('Sure, here is')])
  })

  it('prefers the most recent block when an earlier step shares the payload', () => {
    const content = [text('Let me'), toolUse('tu_1'), toolResult('tu_1'), text('Let me')]
    expect(retractContentBlocks(content, [{ type: 'text', text: 'Let me' }])).toEqual(content.slice(0, 3))
  })

  it('strips a refused thinking prefix the same way', () => {
    const content = [thinking('first' + 'second')]
    expect(retractContentBlocks(content, [{ type: 'thinking', thinking: 'first' }])).toEqual([thinking('second')])
  })

  it('never touches sub-agent blocks — retraction is a top-level frame', () => {
    const content = [text('same', 'agent-1')]
    expect(retractContentBlocks(content, [{ type: 'text', text: 'same' }])).toBe(content)
  })

  it('returns the same ref when nothing matched', () => {
    const content = [...work]
    expect(retractContentBlocks(content, [{ type: 'tool_use', toolUseId: 'gone' }, { type: 'text', text: 'never' }])).toBe(content)
  })
})

describe('applyContentDelta: blocks with a provider id', () => {
  const said = (id: string, t: string): ContentBlock => ({ type: 'text', id, text: t })

  it('continues the block with the same id even when another item streamed after it', () => {
    let content: ContentBlock[] = []
    content = applyContentDelta(content, said('a', 'Hello'))
    content = applyContentDelta(content, said('b', 'Other'))
    content = applyContentDelta(content, said('a', ' world'))
    expect(content).toEqual([said('a', 'Hello world'), said('b', 'Other')])
  })

  it('keeps adjacent items with different ids apart', () => {
    let content: ContentBlock[] = []
    content = applyContentDelta(content, said('a', 'One.'))
    content = applyContentDelta(content, said('b', 'Two.'))
    expect(content).toHaveLength(2)
  })

  it('replaces the text for a non-prefix rewrite', () => {
    let content: ContentBlock[] = [said('a', 'Draft')]
    content = applyContentDelta(content, said('a', 'Final'), undefined, { replace: true })
    expect(content).toEqual([said('a', 'Final')])
  })

  it('never merges positional text into an identified block, or the reverse', () => {
    let content: ContentBlock[] = [said('a', 'item')]
    content = applyContentDelta(content, { type: 'text', text: ' loose' })
    content = applyContentDelta(content, said('b', 'next'))
    expect(content).toEqual([said('a', 'item'), { type: 'text', text: ' loose' }, said('b', 'next')])
  })

  it('keeps the first start and advances the end of identified thinking, even for a timestamp-only update', () => {
    let content: ContentBlock[] = [{ type: 'thinking', id: 'r', thinking: 'Think', startedAt: 1, endedAt: 2 }]
    content = applyContentDelta(content, { type: 'thinking', id: 'r', thinking: '', startedAt: 5, endedAt: 9 })
    expect(content).toEqual([{ type: 'thinking', id: 'r', thinking: 'Think', startedAt: 1, endedAt: 9 }])
  })

  it('appends plan text and replaces review and notice blocks whole', () => {
    let content: ContentBlock[] = []
    content = applyContentDelta(content, { type: 'plan', id: 'p', text: '1. Read' })
    content = applyContentDelta(content, { type: 'plan', id: 'p', text: '\n2. Edit' })
    content = applyContentDelta(content, { type: 'notice', id: 'e', level: 'error', text: 'first' })
    content = applyContentDelta(content, { type: 'notice', id: 'e', level: 'error', text: 'second' })
    expect(content).toEqual([
      { type: 'plan', id: 'p', text: '1. Read\n2. Edit' },
      { type: 'notice', id: 'e', level: 'error', text: 'second' },
    ])
  })

  it('scopes an id to its parent', () => {
    let content: ContentBlock[] = [{ type: 'text', id: 'm', text: 'main', parentToolUseId: null }]
    content = applyContentDelta(content, { type: 'text', id: 'm', text: 'child', parentToolUseId: 'agent-1' })
    expect(content).toHaveLength(2)
  })
})

describe('applyContentDelta: streamed tool output', () => {
  const call = (outputDelta?: string): ContentBlock => ({
    type: 'tool_use', toolName: 'Bash', toolUseId: 'c', input: '{"command":"ls"}', status: 'streaming',
    ...(outputDelta !== undefined ? { outputDelta } : {}),
  })

  it('accumulates output deltas into liveOutput without storing the delta field', () => {
    let content: ContentBlock[] = []
    content = applyContentDelta(content, call('a\n'), () => 1)
    content = applyContentDelta(content, call('b\n'), () => 2)
    expect(content).toHaveLength(1)
    expect(content[0]).toMatchObject({ toolUseId: 'c', status: 'streaming', liveOutput: 'a\nb\n', startedAt: 1 })
    expect(content[0]).not.toHaveProperty('outputDelta')
  })

  it('replaces liveOutput when asked', () => {
    let content = applyContentDelta([], call('old'), () => 1)
    content = applyContentDelta(content, call('new'), () => 2, { replace: true })
    expect(content[0]).toMatchObject({ liveOutput: 'new' })
  })

  it('keeps partial output through a seal and drops it once the result lands', () => {
    const streamed = applyContentDelta([], call('partial'), () => 1)
    expect(sealStreamingTools(streamed)[0]).toMatchObject({ status: 'complete', liveOutput: 'partial' })
    const finished = applyContentDelta(streamed, { type: 'tool_result', toolUseId: 'c', summary: 'partial\nrest', exitCode: 0 })
    expect(finished[0]).not.toHaveProperty('liveOutput')
    expect(finished[0]).toMatchObject({ status: 'complete' })
  })
})
