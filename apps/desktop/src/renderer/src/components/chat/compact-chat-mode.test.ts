import { describe, expect, it } from 'vitest'
import {
  collapsibleItems,
  countVisibleClaudeProcessSegments,
  isClaudePinnedSegment,
  isCodexPinnedSegment,
  isVisibleClaudeProcessSegment,
  partitionTurnForCompactMode,
} from './compact-chat-mode'

const WIDGET_SHOW = 'mcp__superone__widget_show'

/** Compact label for a run list: `p:` prefixes a pinned run. */
const shape = <T extends { id?: string; kind: string }>(
  runs: ReadonlyArray<{ collapsible: boolean; items: T[] }>,
) => runs.map((run) => `${run.collapsible ? 'c' : 'p'}:${run.items.map((i) => i.id ?? i.kind).join(',')}`)

const text = (id: string) => ({ kind: 'block', block: { type: 'text' }, id })

describe('partitionTurnForCompactMode', () => {
  it('pins the whole turn when it is all text', () => {
    const items = [text('a'), text('b')]
    const runs = partitionTurnForCompactMode(items, isClaudePinnedSegment)
    expect(shape(runs)).toEqual(['p:a,b'])
    expect(collapsibleItems(runs)).toEqual([])
  })

  it('collapses the whole turn when it has no pinned content at all', () => {
    const items = [{ kind: 'thinking' }, { kind: 'tools' }]
    const runs = partitionTurnForCompactMode(items, isClaudePinnedSegment)
    expect(shape(runs)).toEqual(['c:thinking,tools'])
    expect(collapsibleItems(runs)).toEqual(items)
  })

  it('keeps mid-turn markdown visible in place instead of collapsing it', () => {
    const items = [
      { kind: 'thinking' },
      text('mid'),
      { kind: 'tools', id: 'tools' },
      text('final-1'),
      text('final-2'),
    ]
    const runs = partitionTurnForCompactMode(items, isClaudePinnedSegment)
    expect(shape(runs)).toEqual(['c:thinking', 'p:mid', 'c:tools', 'p:final-1,final-2'])
    expect(collapsibleItems(runs).map((s) => ('id' in s ? s.id : s.kind))).toEqual(['thinking', 'tools'])
  })

  it('pins widget_show tool calls wherever they appear', () => {
    const items = [
      { kind: 'tools', id: 'early' },
      { kind: 'block', block: { type: 'tool_use', toolName: WIDGET_SHOW }, id: 'widget' },
      { kind: 'tools', id: 'late' },
      text('answer'),
    ]
    const runs = partitionTurnForCompactMode(items, isClaudePinnedSegment)
    expect(shape(runs)).toEqual(['c:early', 'p:widget', 'c:late', 'p:answer'])
  })

  it('does not pin an ordinary tool call', () => {
    const items = [
      { kind: 'block', block: { type: 'tool_use', toolName: 'Read' }, id: 'read' },
      text('answer'),
    ]
    expect(shape(partitionTurnForCompactMode(items, isClaudePinnedSegment))).toEqual(['c:read', 'p:answer'])
  })

  it('on interrupt (ends mid-process), pins everything after the last markdown', () => {
    const items = [
      { kind: 'thinking' },
      { kind: 'tools', id: 'early-tools' },
      text('answer'),
      { kind: 'tools', id: 'after-tools' },
    ]
    const runs = partitionTurnForCompactMode(items, isClaudePinnedSegment)
    expect(shape(runs)).toEqual(['c:thinking,early-tools', 'p:answer,after-tools'])
  })

  it('returns no runs for an empty turn', () => {
    expect(partitionTurnForCompactMode([], isClaudePinnedSegment)).toEqual([])
  })
})

describe('isCodexPinnedSegment', () => {
  const itemAt = (items: ReadonlyArray<{ type: string; server?: string; tool?: string }>) =>
    (index: number) => items[index]

  it('pins agent_message and plan items', () => {
    const items = [
      { type: 'reasoning' },
      { type: 'command_execution' },
      { type: 'agent_message' },
      { type: 'plan' },
    ]
    const segs = [
      { kind: 'reasoning' as const, id: 'reasoning' },
      { kind: 'item' as const, index: 1, id: 'cmd' },
      { kind: 'item' as const, index: 2, id: 'msg' },
      { kind: 'item' as const, index: 3, id: 'plan' },
    ]
    const runs = partitionTurnForCompactMode(segs, (s) => isCodexPinnedSegment(s, itemAt(items)))
    expect(shape(runs)).toEqual(['c:reasoning,cmd', 'p:msg,plan'])
  })

  it('pins a mid-turn widget_show mcp call', () => {
    const items = [
      { type: 'command_execution' },
      { type: 'mcp_tool_call', server: 'superone', tool: 'widget_show' },
      { type: 'command_execution' },
      { type: 'agent_message' },
    ]
    const segs = [
      { kind: 'item' as const, index: 0, id: 'cmd-1' },
      { kind: 'item' as const, index: 1, id: 'widget' },
      { kind: 'item' as const, index: 2, id: 'cmd-2' },
      { kind: 'item' as const, index: 3, id: 'msg' },
    ]
    const runs = partitionTurnForCompactMode(segs, (s) => isCodexPinnedSegment(s, itemAt(items)))
    expect(shape(runs)).toEqual(['c:cmd-1', 'p:widget', 'c:cmd-2', 'p:msg'])
  })

  it('does not pin other mcp calls', () => {
    const items = [{ type: 'mcp_tool_call', server: 'superone', tool: 'browser_click' }, { type: 'agent_message' }]
    const segs = [
      { kind: 'item' as const, index: 0, id: 'click' },
      { kind: 'item' as const, index: 1, id: 'msg' },
    ]
    expect(shape(partitionTurnForCompactMode(segs, (s) => isCodexPinnedSegment(s, itemAt(items)))))
      .toEqual(['c:click', 'p:msg'])
  })

  it('on interrupt ending in a command, pins the last agent_message and the command after it', () => {
    const items = [
      { type: 'reasoning' },
      { type: 'command_execution' },
      { type: 'agent_message' },
      { type: 'command_execution' },
    ]
    const segs = [
      { kind: 'reasoning' as const, id: 'reasoning' },
      { kind: 'item' as const, index: 1, id: 'cmd-1' },
      { kind: 'item' as const, index: 2, id: 'msg' },
      { kind: 'item' as const, index: 3, id: 'cmd-2' },
    ]
    const runs = partitionTurnForCompactMode(segs, (s) => isCodexPinnedSegment(s, itemAt(items)))
    expect(shape(runs)).toEqual(['c:reasoning,cmd-1', 'p:msg,cmd-2'])
  })
})

describe('isVisibleClaudeProcessSegment', () => {
  const hidden = new Set(['TodoWrite', 'mcp__superone__session_rename'])
  const opts = {
    toolResultAt: () => undefined as string | undefined,
    isHiddenTool: (name: string) => hidden.has(name),
  }

  it('counts thinking and text as visible', () => {
    expect(isVisibleClaudeProcessSegment({ kind: 'thinking' }, opts)).toBe(true)
    expect(isVisibleClaudeProcessSegment(
      { kind: 'block', block: { type: 'text' } },
      opts,
    )).toBe(true)
  })

  it('hides paired tool_result shells (attached to ToolBlock, render nothing)', () => {
    expect(isVisibleClaudeProcessSegment(
      { kind: 'block', block: { type: 'tool_result', toolUseId: 't1' } },
      opts,
    )).toBe(false)
  })

  it('hides tool_use blocks that isHiddenTool marks invisible', () => {
    expect(isVisibleClaudeProcessSegment(
      { kind: 'block', block: { type: 'tool_use', toolName: 'TodoWrite', toolUseId: 't1' } },
      opts,
    )).toBe(false)
    expect(isVisibleClaudeProcessSegment(
      {
        kind: 'block',
        block: { type: 'tool_use', toolName: 'mcp__superone__session_rename', toolUseId: 't2' },
      },
      opts,
    )).toBe(false)
  })

  it('counts a normal tool_use as visible', () => {
    expect(isVisibleClaudeProcessSegment(
      { kind: 'block', block: { type: 'tool_use', toolName: 'SearchTools', toolUseId: 't1' } },
      opts,
    )).toBe(true)
  })

  it('counts tools groups only when they contain a visible tool_use', () => {
    expect(isVisibleClaudeProcessSegment(
      {
        kind: 'tools',
        blocks: [
          { type: 'tool_use', toolName: 'TodoWrite', toolUseId: 'a' },
          { type: 'tool_result', toolUseId: 'a' },
        ],
      },
      opts,
    )).toBe(false)
    expect(isVisibleClaudeProcessSegment(
      {
        kind: 'tools',
        blocks: [
          { type: 'tool_use', toolName: 'Read', toolUseId: 'b' },
          { type: 'tool_result', toolUseId: 'b' },
        ],
      },
      opts,
    )).toBe(true)
  })

  it('countVisibleClaudeProcessSegments ignores invisible shells', () => {
    // Thought + mid text + tool_use + tool_result shell + Thought → 4 visible (not 5)
    expect(countVisibleClaudeProcessSegments(
      [
        { kind: 'thinking' },
        { kind: 'block', block: { type: 'text' } },
        { kind: 'block', block: { type: 'tool_use', toolName: 'SearchTools', toolUseId: 't1' } },
        { kind: 'block', block: { type: 'tool_result', toolUseId: 't1' } },
        { kind: 'thinking' },
      ],
      opts,
    )).toBe(4)
  })
})

