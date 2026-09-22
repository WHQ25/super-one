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

  it('folds a Bash call\'s working-tree diff into the file stat as one tool call', () => {
    const stats = summarizeClaudeProcess(
      [
        {
          kind: 'block',
          block: { type: 'tool_use', toolName: 'Bash', toolUseId: 'b1', input: '{"command":"sed -i s/a/b/ a.ts && printf x > b.ts"}' },
        },
        {
          kind: 'block',
          block: { type: 'tool_use', toolName: 'Edit', toolUseId: 'e1', input: '{"file_path":"a.ts","old_string":"a","new_string":"b\\nc"}' },
        },
      ],
      {
        ...opts,
        bashEditDiffAt: (id) => id === 'b1'
          ? {
              files: [
                { filePath: 'a.ts', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] },
                { filePath: 'b.ts', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+x'] }], created: true },
              ],
              moreFiles: 0,
            }
          : undefined,
      },
    )
    // a.ts is one file whether Bash or Edit touched it; lines add up across both.
    expect(stats).toEqual({ toolCalls: 2, filesChanged: 2, added: 4, removed: 2 })
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

  it('uses projected toolLineDelta when mutation bodies are stripped', () => {
    const stats = summarizeClaudeProcess(
      [
        {
          kind: 'block',
          block: {
            type: 'tool_use',
            toolName: 'Edit',
            toolUseId: 'e1',
            input: '{"file_path":"a.ts"}',
            toolLineDelta: { added: 2, removed: 1 },
          },
        },
        {
          kind: 'block',
          block: {
            type: 'tool_use',
            toolName: 'Write',
            toolUseId: 'w1',
            input: '{"file_path":"b.ts"}',
            toolLineDelta: { added: 3, removed: 0 },
          },
        },
      ],
      opts,
    )
    expect(stats).toEqual({ toolCalls: 2, filesChanged: 2, added: 5, removed: 1 })
  })

  it('does not double-count when bodies and toolLineDelta are both present', () => {
    const stats = summarizeClaudeProcess(
      [
        {
          kind: 'block',
          block: {
            type: 'tool_use',
            toolName: 'Edit',
            toolUseId: 'e1',
            input: '{"file_path":"a.ts","old_string":"a","new_string":"b\\nc"}',
            toolLineDelta: { added: 2, removed: 1 },
          },
        },
      ],
      opts,
    )
    expect(stats).toEqual({ toolCalls: 1, filesChanged: 1, added: 2, removed: 1 })
  })

  it('uses toolFilePath when sanitized input has no path', () => {
    const stats = summarizeClaudeProcess(
      [
        {
          kind: 'block',
          block: {
            type: 'tool_use',
            toolName: 'write_file',
            toolUseId: 'w1',
            input: '{}',
            toolFilePath: 'src/app.ts',
            toolLineDelta: { added: 4, removed: 0 },
          },
        },
      ],
      opts,
    )
    expect(stats).toEqual({ toolCalls: 1, filesChanged: 1, added: 4, removed: 0 })
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

  it('counts a subagent as one call but folds its child edits (Grok path aliases too) into the turn', () => {
    const stats = summarizeClaudeProcess(
      [
        {
          kind: 'subagent',
          taskBlock: { type: 'tool_use', toolName: 'Agent', toolUseId: 'agent-1', input: '{}' },
          childBlocks: [
            { type: 'tool_use', toolName: 'Read', toolUseId: 'r1', input: '{"file_path":"src/app.ts"}' },
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
    expect(stats).toEqual({ toolCalls: 1, filesChanged: 1, added: 2, removed: 0 })
  })

  it('skips a subagent child edit that failed or was denied', () => {
    const stats = summarizeClaudeProcess(
      [
        {
          kind: 'subagent',
          taskBlock: { type: 'tool_use', toolName: 'Agent', toolUseId: 'agent-1', input: '{}' },
          childBlocks: [
            { type: 'tool_use', toolName: 'Write', toolUseId: 'w-denied', input: '{"file_path":"a.ts","content":"x"}' },
            { type: 'tool_use', toolName: 'Write', toolUseId: 'w-error', input: '{"file_path":"b.ts","content":"y"}' },
          ],
        },
      ],
      {
        ...opts,
        toolResultAt: (id) => (id === 'w-denied' ? '[denied] nope' : undefined),
        isErrorTool: (id) => id === 'w-error',
      },
    )
    expect(stats).toEqual({ toolCalls: 1, filesChanged: 0, added: 0, removed: 0 })
  })

  it('reads taskFileChanges when the shell carries no children (progressive remote) and dedupes paths with the turn', () => {
    const stats = summarizeClaudeProcess(
      [
        {
          kind: 'block',
          block: { type: 'tool_use', toolName: 'Edit', toolUseId: 'e1', input: '{"file_path":"src/app.ts","old_string":"a","new_string":"b\\nc"}' },
        },
        {
          kind: 'subagent',
          taskBlock: {
            type: 'tool_use',
            toolName: 'Agent',
            toolUseId: 'agent-1',
            input: '{}',
            taskFileChanges: [
              { path: 'src/app.ts', added: 3, removed: 1 },
              { path: 'src/other.ts', added: 0, removed: 0 },
            ],
          },
          childBlocks: [],
        },
      ],
      opts,
    )
    // Own Edit is +2 −1; the subagent adds +3 −1 on the same file (deduped) and touches one more.
    expect(stats).toEqual({ toolCalls: 2, filesChanged: 2, added: 5, removed: 2 })
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

  it('uses item.toolLineDelta when file_change diffs are stripped', () => {
    const projected: CodexThreadItem[] = [
      {
        id: 'f1',
        type: 'file_change',
        status: 'completed',
        toolLineDelta: { added: 4, removed: 1 },
        changes: [
          { path: 'a.ts', kind: 'update' },
          { path: 'b.ts', kind: 'add' },
        ],
      },
    ]
    expect(summarizeCodexProcess([{ kind: 'item', index: 0 }], projected)).toEqual({
      toolCalls: 1,
      filesChanged: 2,
      added: 4,
      removed: 1,
    })
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
