import { describe, expect, it } from 'vitest'
import {
  countVisibleClaudeProcessSegments,
  isClaudeConclusionSegment,
  isCodexConclusionSegment,
  isVisibleClaudeProcessSegment,
  splitTurnForCompactMode,
} from './compact-chat-mode'

describe('splitTurnForCompactMode', () => {
  it('returns empty process when the whole turn is conclusion text', () => {
    const items = [
      { kind: 'block', block: { type: 'text' } },
      { kind: 'block', block: { type: 'text' } },
    ]
    const split = splitTurnForCompactMode(items, isClaudeConclusionSegment)
    expect(split.process).toEqual([])
    expect(split.conclusion).toEqual(items)
  })

  it('returns empty conclusion when the turn has no markdown at all', () => {
    const items = [
      { kind: 'thinking' },
      { kind: 'tools' },
    ]
    const split = splitTurnForCompactMode(items, isClaudeConclusionSegment)
    expect(split.process).toEqual(items)
    expect(split.conclusion).toEqual([])
  })

  it('keeps only trailing contiguous text as conclusion', () => {
    const items = [
      { kind: 'thinking' },
      { kind: 'block', block: { type: 'text' }, id: 'mid' },
      { kind: 'tools' },
      { kind: 'block', block: { type: 'text' }, id: 'final-1' },
      { kind: 'block', block: { type: 'text' }, id: 'final-2' },
    ]
    const split = splitTurnForCompactMode(items, isClaudeConclusionSegment)
    expect(split.process.map((s) => ('id' in s ? s.id : s.kind))).toEqual(['thinking', 'mid', 'tools'])
    expect(split.conclusion.map((s) => ('id' in s ? s.id : s.kind))).toEqual(['final-1', 'final-2'])
  })

  it('on interrupt (ends mid-process), shows last markdown and everything after it', () => {
    const items = [
      { kind: 'thinking' },
      { kind: 'tools', id: 'early-tools' },
      { kind: 'block', block: { type: 'text' }, id: 'answer' },
      { kind: 'tools', id: 'after-tools' },
    ]
    const split = splitTurnForCompactMode(items, isClaudeConclusionSegment)
    expect(split.process.map((s) => ('id' in s ? s.id : s.kind))).toEqual(['thinking', 'early-tools'])
    expect(split.conclusion.map((s) => ('id' in s ? s.id : s.kind))).toEqual(['answer', 'after-tools'])
  })

  it('on interrupt after contiguous final text, keeps the whole final text block plus tail', () => {
    const items = [
      { kind: 'tools', id: 'early' },
      { kind: 'block', block: { type: 'text' }, id: 'mid' },
      { kind: 'tools', id: 'mid-tools' },
      { kind: 'block', block: { type: 'text' }, id: 'final-1' },
      { kind: 'block', block: { type: 'text' }, id: 'final-2' },
      { kind: 'tools', id: 'interrupted-tools' },
    ]
    const split = splitTurnForCompactMode(items, isClaudeConclusionSegment)
    expect(split.process.map((s) => s.id)).toEqual(['early', 'mid', 'mid-tools'])
    expect(split.conclusion.map((s) => s.id)).toEqual([
      'final-1',
      'final-2',
      'interrupted-tools',
    ])
  })
})

describe('isCodexConclusionSegment', () => {
  const types = ['reasoning', 'command_execution', 'agent_message', 'plan'] as const
  const itemTypeAt = (index: number) => types[index]

  it('treats trailing agent_message and plan as conclusion', () => {
    const segs = [
      { kind: 'reasoning' as const },
      { kind: 'item' as const, index: 1 },
      { kind: 'item' as const, index: 2 },
      { kind: 'item' as const, index: 3 },
    ]
    const split = splitTurnForCompactMode(segs, (s) => isCodexConclusionSegment(s, itemTypeAt))
    expect(split.process).toHaveLength(2)
    expect(split.conclusion.map((s) => s.index)).toEqual([2, 3])
  })

  it('on interrupt ending in a command, shows last agent_message and the command after it', () => {
    // reasoning, command, agent_message, command (interrupted)
    const interruptTypes = ['reasoning', 'command_execution', 'agent_message', 'command_execution'] as const
    const segs = [
      { kind: 'reasoning' as const },
      { kind: 'item' as const, index: 1 },
      { kind: 'item' as const, index: 2 },
      { kind: 'item' as const, index: 3 },
    ]
    const split = splitTurnForCompactMode(
      segs,
      (s) => isCodexConclusionSegment(s, (i) => interruptTypes[i]),
    )
    expect(split.process.map((s) => ('index' in s ? s.index : s.kind))).toEqual(['reasoning', 1])
    expect(split.conclusion.map((s) => s.index)).toEqual([2, 3])
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

