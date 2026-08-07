import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@superone/shared/agent-types'
import {
  parseJsonlOutput,
  entriesFromRecords,
  normalizeTranscriptTool,
  computeSubagentElapsed,
  groupSubagentChildren,
  collectSubagentSubtree,
  parseSubagentIdFromText,
  looksLikeBackgroundSubagentAck,
  resolveTaskProgressEntry,
  type SubagentChildItem,
} from './subagent-utils'

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
    expect(entries[1]).toMatchObject({
      type: 'tool',
      toolName: 'Read',
      description: '/a.ts',
      input: JSON.stringify({ file_path: '/a.ts' }),
    })
    expect(entries[2]).toEqual({ type: 'activity', text: 'done' })
    expect(resultText).toBe('done')
  })

  it('parses a StructuredOutput tool_use into a structured entry carrying its input', () => {
    const raw = [
      line([{ type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } }]),
      line([{ type: 'tool_use', name: 'StructuredOutput', input: { verdict: 'CONFIRMED', evidence: 'line 42' } }]),
    ].join('\n')

    const { entries } = parseJsonlOutput(raw)
    expect(entries[0]).toMatchObject({ type: 'tool', toolName: 'Read', description: '/a.ts' })
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

  it('parses Grok Build chat_history.jsonl (assistant.tool_calls + tool_result)', () => {
    const raw = [
      JSON.stringify({
        type: 'assistant',
        content: 'Scanning session ops',
        tool_calls: [
          { id: 'c1', name: 'grep', arguments: JSON.stringify({ pattern: 'session', path: '/proj' }) },
          { id: 'c2', name: 'list_dir', arguments: JSON.stringify({ target_directory: '/proj/src' }) },
        ],
      }),
      JSON.stringify({ type: 'tool_result', tool_call_id: 'c1', content: '…hits…' }),
      JSON.stringify({ type: 'tool_result', tool_call_id: 'c2', content: '…dirs…' }),
      JSON.stringify({ type: 'assistant', content: 'Found 3 local-only gaps.' }),
    ].join('\n')

    const { entries, resultText } = parseJsonlOutput(raw)
    expect(entries).toEqual([
      { type: 'activity', text: 'Scanning session ops' },
      {
        type: 'tool',
        toolName: 'Grep',
        description: 'session in /proj',
        toolUseId: 'c1',
        input: JSON.stringify({ pattern: 'session', path: '/proj' }),
        result: '…hits…',
      },
      {
        type: 'tool',
        toolName: 'LS',
        description: '/proj/src',
        toolUseId: 'c2',
        input: JSON.stringify({ target_directory: '/proj/src', path: '/proj/src' }),
        result: '…dirs…',
      },
      { type: 'activity', text: 'Found 3 local-only gaps.' },
    ])
    expect(resultText).toBe('Found 3 local-only gaps.')
  })

  it('unwraps ListDir JSON tool_result envelopes for ToolBlock display', () => {
    const tree = '- /proj\n  - a.ts\n'
    const raw = [
      JSON.stringify({
        type: 'assistant',
        content: '',
        tool_calls: [
          { id: 'l1', name: 'list_dir', arguments: { target_directory: '/proj' } },
        ],
      }),
      JSON.stringify({
        type: 'tool_result',
        tool_call_id: 'l1',
        content: JSON.stringify({
          type: 'ListDir',
          Content: { content: tree, absolute_root_path: '/proj' },
        }),
      }),
    ].join('\n')
    const { entries } = parseJsonlOutput(raw)
    expect(entries[0]).toMatchObject({ type: 'tool', toolName: 'LS', result: tree })
  })

  it('normalizes Grok read_file / run_terminal_command onto Read / Bash with Claude-shaped input', () => {
    const raw = [
      JSON.stringify({
        type: 'assistant',
        content: '',
        tool_calls: [
          { id: 'r1', name: 'read_file', arguments: { target_file: '/a.ts', offset: 10, limit: 20 } },
          { id: 'b1', name: 'run_terminal_command', arguments: { command: 'ls', description: 'list' } },
          { id: 'u1', name: 'use_tool', arguments: { tool_name: 'superone__session_rename', tool_input: { title: 'x' } } },
        ],
      }),
      JSON.stringify({ type: 'tool_result', tool_call_id: 'r1', content: 'file body' }),
    ].join('\n')

    const { entries } = parseJsonlOutput(raw)
    expect(entries[0]).toMatchObject({
      type: 'tool',
      toolName: 'Read',
      toolUseId: 'r1',
      description: '/a.ts',
      result: 'file body',
    })
    expect(JSON.parse((entries[0] as { input: string }).input)).toEqual({
      target_file: '/a.ts',
      offset: 10,
      limit: 20,
      file_path: '/a.ts',
    })
    expect(entries[1]).toMatchObject({
      type: 'tool',
      toolName: 'Bash',
      toolUseId: 'b1',
      description: 'ls',
    })
    expect(JSON.parse((entries[1] as { input: string }).input)).toMatchObject({ command: 'ls', description: 'list' })
    expect(entries[2]).toMatchObject({
      type: 'tool',
      toolName: 'mcp__superone__session_rename',
      toolUseId: 'u1',
    })
    expect(JSON.parse((entries[2] as { input: string }).input)).toEqual({ title: 'x' })
  })
})

describe('normalizeTranscriptTool', () => {
  it('maps search_replace → Edit and keeps old/new strings', () => {
    const { toolName, input } = normalizeTranscriptTool('search_replace', {
      file_path: '/x.ts',
      old_string: 'a',
      new_string: 'b',
    })
    expect(toolName).toBe('Edit')
    expect(input).toEqual({ file_path: '/x.ts', old_string: 'a', new_string: 'b' })
  })
})

describe('entriesFromRecords', () => {
  it('maps SDK-shaped assistant records identically to parseJsonlOutput', () => {
    const records = [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'thinking...' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'StructuredOutput', input: { verdict: 'ok' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'body' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
    ]
    const { entries, resultText } = entriesFromRecords(records)
    expect(entries).toEqual([
      { type: 'activity', text: 'thinking...' },
      {
        type: 'tool',
        toolName: 'Read',
        description: '/a.ts',
        toolUseId: 't1',
        input: JSON.stringify({ file_path: '/a.ts' }),
        result: 'body',
      },
      { type: 'structured', data: { verdict: 'ok' } },
      { type: 'activity', text: 'done' },
    ])
    expect(resultText).toBe('done')
  })

  it('ignores non-assistant records', () => {
    const records = [
      { type: 'user', message: { content: [{ type: 'tool_result', text: 'ignored' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'kept' }] } },
    ]
    const { entries } = entriesFromRecords(records)
    expect(entries).toEqual([{ type: 'activity', text: 'kept' }])
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

describe('subagent progress helpers', () => {
  it('parses subagent_id from Grok plain-text ack', () => {
    expect(parseSubagentIdFromText('Subagent started in background.\nsubagent_id: abc-1\n')).toBe('abc-1')
    expect(parseSubagentIdFromText('task_ids=["xyz-9"]')).toBe('xyz-9')
  })

  it('requires started-in-background or background+subagent_id for bg ack', () => {
    expect(looksLikeBackgroundSubagentAck('Subagent started in background.\nsubagent_id: x')).toBe(true)
    expect(looksLikeBackgroundSubagentAck('subagent_id: x\nrun in background')).toBe(true)
    expect(looksLikeBackgroundSubagentAck('see subagent_id: x in docs')).toBe(false)
  })

  it('resolves provisional taskId key when toolUseId entry is missing', () => {
    const map = {
      'sa-1': { taskId: 'sa-1', description: 'work', completed: true },
    }
    expect(resolveTaskProgressEntry(map, 'tu-1', 'sa-1')).toEqual(map['sa-1'])
    expect(resolveTaskProgressEntry({ 'tu-1': { taskId: 'sa-1', description: 'a' } }, 'tu-1', 'sa-1'))
      .toEqual({ taskId: 'sa-1', description: 'a' })
  })
})
