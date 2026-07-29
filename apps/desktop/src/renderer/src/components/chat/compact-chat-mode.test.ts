import { describe, expect, it } from 'vitest'
import {
  countClaudeProcessTools,
  countCodexProcessTools,
  isClaudeConclusionSegment,
  isCodexConclusionSegment,
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

  it('returns empty conclusion when the turn ends with process', () => {
    const items = [
      { kind: 'block', block: { type: 'text' } },
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
})

describe('countClaudeProcessTools', () => {
  it('counts tool_use blocks across tool groups and singles', () => {
    expect(countClaudeProcessTools([
      { kind: 'thinking' },
      { kind: 'tools', blocks: [{ type: 'tool_use' }, { type: 'tool_result' }, { type: 'tool_use' }] },
      { kind: 'block', block: { type: 'tool_use' } },
      { kind: 'subagent' },
    ])).toBe(4)
  })
})

describe('countCodexProcessTools', () => {
  it('counts commands and mcp calls but not reasoning', () => {
    const types = ['reasoning', 'command_execution', 'mcp_tool_call', 'agent_message'] as const
    expect(countCodexProcessTools(
      [
        { kind: 'reasoning' },
        { kind: 'group', indices: [1, 1] },
        { kind: 'item', index: 2 },
      ],
      (i) => types[i],
    )).toBe(3)
  })
})
