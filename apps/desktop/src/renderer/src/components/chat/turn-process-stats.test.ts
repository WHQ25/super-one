import { describe, expect, it } from 'vitest'
import type { CodexThreadItem } from '@superone/shared/agent-types'
import {
  summarizeClaudeProcess,
  summarizeCodexProcess,
} from './turn-process-stats'

const hidden = new Set(['TodoWrite', 'mcp__superone__session_rename'])

const opts = {
  toolResultAt: () => undefined as string | undefined,
  isHiddenTool: (name: string) => hidden.has(name),
}

describe('summarizeClaudeProcess', () => {
  it('counts visible tool calls and unique file mutations', () => {
    const stats = summarizeClaudeProcess(
      [
        { kind: 'thinking' },
        {
          kind: 'tools',
          blocks: [
            { type: 'tool_use', toolName: 'Read', toolUseId: 'r1', input: '{"file_path":"a.ts"}' },
            { type: 'tool_result', toolUseId: 'r1' },
            { type: 'tool_use', toolName: 'Edit', toolUseId: 'e1', input: '{"file_path":"a.ts","old_string":"a\\nb","new_string":"c\\nd\\ne"}' },
            { type: 'tool_result', toolUseId: 'e1' },
          ],
        },
        {
          kind: 'block',
          block: {
            type: 'tool_use',
            toolName: 'Write',
            toolUseId: 'w1',
            input: '{"file_path":"b.ts","content":"one\\ntwo"}',
          },
        },
      ],
      opts,
    )
    expect(stats).toEqual({ toolCalls: 3, filesChanged: 2, added: 5, removed: 2 })
  })

  it('counts Cursor Edit mutations from result.diff when old/new strings are absent', () => {
    const stats = summarizeClaudeProcess(
      [
        {
          kind: 'block',
          block: {
            type: 'tool_use',
            toolName: 'Edit',
            toolUseId: 'e1',
            input: '{"file_path":"a.ts","diff":"@@ -1,1 +1,2 @@\\n-old\\n+new1\\n+new2"}',
          },
        },
      ],
      opts,
    )
    expect(stats).toEqual({ toolCalls: 1, filesChanged: 1, added: 2, removed: 1 })
  })

  it('ignores hidden tools and denied / error mutations', () => {
    const stats = summarizeClaudeProcess(
      [
        {
          kind: 'block',
          block: { type: 'tool_use', toolName: 'TodoWrite', toolUseId: 't1', input: '{}' },
        },
        {
          kind: 'block',
          block: {
            type: 'tool_use',
            toolName: 'Write',
            toolUseId: 'w1',
            input: '{"file_path":"secret.ts","content":"x"}',
          },
        },
        {
          kind: 'block',
          block: {
            type: 'tool_use',
            toolName: 'Edit',
            toolUseId: 'e1',
            input: '{"file_path":"fail.ts","old_string":"a","new_string":"b"}',
          },
        },
      ],
      {
        toolResultAt: (id) => (id === 'w1' ? '[denied] User denied permission' : undefined),
        isHiddenTool: (name) => hidden.has(name),
        isErrorTool: (id) => id === 'e1',
      },
    )
    expect(stats).toEqual({ toolCalls: 2, filesChanged: 0, added: 0, removed: 0 })
  })

  it('includes subagent child tools and Grok path aliases', () => {
    const stats = summarizeClaudeProcess(
      [
        {
          kind: 'subagent',
          taskBlock: { type: 'tool_use', toolName: 'Agent', toolUseId: 'agent-1', input: '{}' },
          childBlocks: [
            {
              type: 'tool_use',
              toolName: 'write_file',
              toolUseId: 'w1',
              input: '{"target_file":"src/app.ts","contents":"line1\\nline2"}',
            },
          ],
        },
      ],
      opts,
    )
    expect(stats.toolCalls).toBe(2)
    expect(stats.filesChanged).toBe(1)
    expect(stats.added).toBe(2)
    expect(stats.removed).toBe(0)
  })
})

describe('summarizeCodexProcess', () => {
  const items: CodexThreadItem[] = [
    { id: 'r1', type: 'reasoning', text: 'thinking' },
    { id: 'c1', type: 'command_execution', command: 'ls', aggregatedOutput: '', status: 'completed' },
    {
      id: 'f1',
      type: 'file_change',
      status: 'completed',
      changes: [
        { path: 'a.ts', kind: 'update', diff: '@@\n-old\n+new\n+extra\n' },
        { path: 'b.ts', kind: 'add', diff: 'hello\nworld\n' },
      ],
    },
    { id: 'm1', type: 'agent_message', text: 'done' },
  ]

  it('counts tool-like items and file_change diffs', () => {
    const stats = summarizeCodexProcess(
      [
        { kind: 'reasoning', indices: [0] },
        { kind: 'item', index: 1 },
        { kind: 'item', index: 2 },
      ],
      items,
    )
    expect(stats).toEqual({ toolCalls: 2, filesChanged: 2, added: 4, removed: 1 })
  })

  it('skips file stats when apply_patch failed', () => {
    const failed: CodexThreadItem[] = [
      {
        id: 'f1',
        type: 'file_change',
        status: 'failed',
        changes: [{ path: 'a.ts', kind: 'update', diff: '@@\n-old\n+new\n' }],
      },
    ]
    expect(summarizeCodexProcess([{ kind: 'item', index: 0 }], failed)).toEqual({
      toolCalls: 1,
      filesChanged: 0,
      added: 0,
      removed: 0,
    })
  })
})
