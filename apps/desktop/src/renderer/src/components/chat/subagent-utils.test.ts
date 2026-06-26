import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@superone/shared/agent-types'
import { parseJsonlOutput, computeSubagentElapsed, groupSubagentChildren, collectSubagentSubtree, type SubagentChildItem } from './subagent-utils'

function line(content: Array<{ type: string; name?: string; text?: string; input?: Record<string, unknown> }>): string {
  return JSON.stringify({ type: 'assistant', message: { content } })
}

describe('parseJsonlOutput', () => {
  it('parses tool_use and text blocks', () => {
    const raw = [
      line([{ type: 'text', text: 'thinking...' }]),
      line([{ type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } }]),
      line([{ type: 'text', text: 'done' }]),
    ].join('\n')

    const { entries, resultText } = parseJsonlOutput(raw)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({ type: 'activity', text: 'thinking...' })
    expect(entries[1]).toEqual({ type: 'tool', toolName: 'Read', description: '/a.ts' })
    expect(entries[2]).toEqual({ type: 'activity', text: 'done' })
    expect(resultText).toBe('done')
  })

  it('parses a StructuredOutput tool_use into a structured entry carrying its input', () => {
    const raw = [
      line([{ type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } }]),
      line([{ type: 'tool_use', name: 'StructuredOutput', input: { verdict: 'CONFIRMED', evidence: 'line 42' } }]),
    ].join('\n')

    const { entries } = parseJsonlOutput(raw)
    expect(entries[0]).toEqual({ type: 'tool', toolName: 'Read', description: '/a.ts' })
    expect(entries[1]).toEqual({ type: 'structured', data: { verdict: 'CONFIRMED', evidence: 'line 42' } })
  })

  it('keeps last text entry in entries (not spliced out)', () => {
    const raw = [
      line([{ type: 'text', text: 'first' }]),
      line([{ type: 'text', text: 'second' }]),
    ].join('\n')

    const { entries, resultText } = parseJsonlOutput(raw)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({ type: 'activity', text: 'first' })
    expect(entries[1]).toEqual({ type: 'activity', text: 'second' })
    expect(resultText).toBe('second')
  })

  it('returns undefined resultText when no text blocks', () => {
    const raw = line([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }])
    const { entries, resultText } = parseJsonlOutput(raw)
    expect(entries).toHaveLength(1)
    expect(resultText).toBeUndefined()
  })

  it('returns empty entries for invalid first line', () => {
    const { entries, resultText } = parseJsonlOutput('not json')
    expect(entries).toEqual([])
    expect(resultText).toBeUndefined()
  })

  it('skips non-assistant records', () => {
    const raw = [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'ignored' }] } }),
      line([{ type: 'text', text: 'kept' }]),
    ].join('\n')

    const { entries } = parseJsonlOutput(raw)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({ type: 'activity', text: 'kept' })
  })

  it('handles empty input', () => {
    const { entries, resultText } = parseJsonlOutput('')
    expect(entries).toEqual([])
    expect(resultText).toBeUndefined()
  })
})

describe('groupSubagentChildren', () => {
  const agent = (id: string, parent: string | null): ContentBlock =>
    ({ type: 'tool_use', toolName: 'Agent', toolUseId: id, input: '{}', parentToolUseId: parent } as ContentBlock)
  const tool = (id: string, parent: string | null): ContentBlock =>
    ({ type: 'tool_use', toolName: 'Read', toolUseId: id, input: '{}', parentToolUseId: parent } as ContentBlock)
  const text = (t: string, parent: string | null): ContentBlock =>
    ({ type: 'text', text: t, parentToolUseId: parent } as ContentBlock)
  const result = (id: string, parent: string | null): ContentBlock =>
    ({ type: 'tool_result', toolUseId: id, summary: 'ok', parentToolUseId: parent } as ContentBlock)

  const isSubagent = (i: SubagentChildItem): i is Extract<SubagentChildItem, { kind: 'subagent' }> => i.kind === 'subagent'

  it('renders a single-level subagent’s direct blocks as plain blocks', () => {
    const items = groupSubagentChildren([text('hi', 'A'), tool('r1', 'A')], 'A')
    expect(items.map((i) => i.kind)).toEqual(['block', 'block'])
  })

  it('lifts a nested Agent call into its own segment instead of leaking its output to top level', () => {
    // A spawned B; B emitted text + a tool. Without nesting support, B's text/tool
    // (parentToolUseId === 'B') match no collector and leak as A's direct blocks.
    const items = groupSubagentChildren(
      [text('A reasoning', 'A'), agent('B', 'A'), text('B reasoning', 'B'), tool('rB', 'B'), result('B', 'A')],
      'A',
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ kind: 'block', block: text('A reasoning', 'A') })
    const nested = items[1]
    expect(isSubagent(nested) && nested.segment.taskBlock.toolUseId).toBe('B')
    if (!isSubagent(nested)) throw new Error('expected nested subagent')
    // B's own output is contained inside B's segment, never surfaced as A's blocks.
    expect(nested.segment.childBlocks).toEqual([text('B reasoning', 'B'), tool('rB', 'B')])
    expect(nested.segment.resultBlock).toEqual(result('B', 'A'))
  })

  it('contains a 3-level chain (A→B→C): C’s subtree stays inside B until B is re-grouped', () => {
    const items = groupSubagentChildren(
      [agent('B', 'A'), agent('C', 'B'), text('C reasoning', 'C'), tool('rC', 'C'), result('C', 'B'), result('B', 'A')],
      'A',
    )
    expect(items).toHaveLength(1)
    const b = items[0]
    if (!isSubagent(b)) throw new Error('expected B segment')
    // C and everything under it is held flat in B's childBlocks (no leak to A).
    expect(b.segment.childBlocks).toEqual([agent('C', 'B'), text('C reasoning', 'C'), tool('rC', 'C'), result('C', 'B')])

    // Recursing on B's childBlocks surfaces C as B's nested segment.
    const inner = groupSubagentChildren(b.segment.childBlocks, 'B')
    expect(inner).toHaveLength(1)
    const c = inner[0]
    if (!isSubagent(c)) throw new Error('expected C segment')
    expect(c.segment.taskBlock.toolUseId).toBe('C')
    expect(c.segment.childBlocks).toEqual([text('C reasoning', 'C'), tool('rC', 'C')])
    expect(c.segment.resultBlock).toEqual(result('C', 'B'))
  })

  it('keeps two sibling nested agents separate', () => {
    const items = groupSubagentChildren(
      [agent('B', 'A'), text('b', 'B'), result('B', 'A'), agent('C', 'A'), text('c', 'C'), result('C', 'A')],
      'A',
    )
    const subs = items.filter(isSubagent)
    expect(subs.map((s) => s.segment.taskBlock.toolUseId)).toEqual(['B', 'C'])
    expect(subs[0].segment.childBlocks).toEqual([text('b', 'B')])
    expect(subs[1].segment.childBlocks).toEqual([text('c', 'C')])
  })
})

describe('collectSubagentSubtree', () => {
  const agent = (id: string, parent: string | null): ContentBlock =>
    ({ type: 'tool_use', toolName: 'Agent', toolUseId: id, input: '{}', parentToolUseId: parent } as ContentBlock)
  const tool = (id: string, parent: string | null): ContentBlock =>
    ({ type: 'tool_use', toolName: 'Read', toolUseId: id, input: '{}', parentToolUseId: parent } as ContentBlock)
  const result = (id: string, parent: string | null): ContentBlock =>
    ({ type: 'tool_result', toolUseId: id, summary: 'ok', parentToolUseId: parent } as ContentBlock)

  it('gathers the full subtree (all depths) and drops the root’s own task/result', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: 'top', parentToolUseId: null } as ContentBlock,
      agent('A', null), tool('rA', 'A'),
      agent('B', 'A'), tool('rB', 'B'), result('B', 'A'),
      result('A', null),
    ]
    const subtree = collectSubagentSubtree(content, 'A')
    // Excludes the top-level text, A's own task block, and A's own result.
    expect(subtree).toEqual([tool('rA', 'A'), agent('B', 'A'), tool('rB', 'B'), result('B', 'A')])
  })

  it('scopes to the requested nested root', () => {
    const content: ContentBlock[] = [agent('A', null), agent('B', 'A'), tool('rB', 'B'), result('B', 'A')]
    expect(collectSubagentSubtree(content, 'B')).toEqual([tool('rB', 'B')])
  })
})

describe('computeSubagentElapsed', () => {
  const NOW = 2_000_000_000_000

  function task(extra: Record<string, unknown>): ContentBlock & { type: 'tool_use' } {
    return { type: 'tool_use', toolName: 'Agent', toolUseId: 't', input: '{}', ...extra } as ContentBlock & { type: 'tool_use' }
  }

  it('uses recorded taskUsage.durationMs for a completed agent instead of wall-clock since startedAt', () => {
    const block = task({ startedAt: NOW - 3 * 24 * 3600_000, taskUsage: { totalTokens: 1, toolUses: 1, durationMs: 7139 } })
    expect(computeSubagentElapsed(block, undefined, false, NOW)).toBe(7)
  })

  it('does not use a stale startedAt for a completed agent with no recorded duration', () => {
    const block = task({ startedAt: NOW - 5 * 3600_000 })
    expect(computeSubagentElapsed(block, undefined, false, NOW)).toBe(0)
  })

  it('falls back to live wall-clock while the agent is still running', () => {
    const block = task({ startedAt: NOW - 12_000 })
    expect(computeSubagentElapsed(block, undefined, true, NOW)).toBe(12)
  })

  it('prefers elapsedSeconds over taskUsage and progress', () => {
    const block = task({ elapsedSeconds: 42, taskUsage: { totalTokens: 1, toolUses: 1, durationMs: 99_000 } })
    expect(computeSubagentElapsed(block, { durationMs: 5000 }, false, NOW)).toBe(42)
  })

  it('uses live progress.durationMs when the block carries no recorded duration', () => {
    const block = task({ startedAt: NOW - 999_999 })
    expect(computeSubagentElapsed(block, { durationMs: 8000 }, true, NOW)).toBe(8)
  })
})
