import { describe, expect, it } from 'vitest'
import {
  collapsibleItems,
  countVisibleClaudeProcessSegments,
  isClaudePinnedSegment,
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
  it('collapses tools before a cut when pinned content follows in the same turn', () => {
    const items = [text('progress'), { kind: 'tools', id: 'before-compact' }]
    expect(shape(partitionTurnForCompactMode(items, isClaudePinnedSegment, true)))
      .toEqual(['p:progress', 'c:before-compact'])
    // Without a later answer, this is still an incomplete turn's visible tail.
    expect(shape(partitionTurnForCompactMode(items, isClaudePinnedSegment)))
      .toEqual(['p:progress,before-compact'])
    expect(shape(partitionTurnForCompactMode([{ kind: 'tools', id: 'after-compact' }], isClaudePinnedSegment, false, true)))
      .toEqual(['p:after-compact'])
  })
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

  it('pins pre-split insight blocks — remote surfaces receive them as their own block', () => {
    const items = [
      { kind: 'thinking' },
      { kind: 'tools', id: 'tools' },
      text('answer'),
      { kind: 'block', block: { type: 'insight' }, id: 'insight' },
      text('tail'),
    ]
    const runs = partitionTurnForCompactMode(items, isClaudePinnedSegment)
    expect(shape(runs)).toEqual(['c:thinking,tools', 'p:answer,insight,tail'])
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

  it('pins AskUserQuestion — the question is addressed to the reader, not process', () => {
    const items = [
      { kind: 'tools', id: 'early' },
      { kind: 'block', block: { type: 'tool_use', toolName: 'AskUserQuestion' }, id: 'ask' },
      { kind: 'tools', id: 'late' },
      text('answer'),
    ]
    const runs = partitionTurnForCompactMode(items, isClaudePinnedSegment)
    expect(shape(runs)).toEqual(['c:early', 'p:ask', 'c:late', 'p:answer'])
  })

  it('pins suggested-task cards — only the user can launch them', () => {
    const items = [
      { kind: 'tools', id: 'early' },
      { kind: 'block', block: { type: 'tool_use', toolName: 'mcp__superone__session_suggest_task' }, id: 'suggest' },
      { kind: 'tools', id: 'late' },
      text('answer'),
    ]
    const runs = partitionTurnForCompactMode(items, isClaudePinnedSegment)
    expect(shape(runs)).toEqual(['c:early', 'p:suggest', 'c:late', 'p:answer'])
  })

  it('pins subagent and workflow cards — delegated work stays visible outside Detail', () => {
    const items = [
      { kind: 'tools', id: 'early' },
      { kind: 'subagent', id: 'agent' },
      { kind: 'thinking', id: 'mid' },
      { kind: 'workflow', id: 'workflow' },
      { kind: 'tools', id: 'late' },
      text('answer'),
    ]
    const runs = partitionTurnForCompactMode(items, isClaudePinnedSegment)
    expect(shape(runs)).toEqual(['c:early', 'p:agent', 'c:mid', 'p:workflow', 'c:late', 'p:answer'])
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

