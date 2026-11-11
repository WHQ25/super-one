import { describe, expect, it } from 'vitest'
import type { AgentEvent, BashEditDiff } from '@superone/shared/agent-types'
import { createClaudeAgentEventMapper } from './agent-event-mapper'

const bashEditDiff: BashEditDiff = {
  files: [{ filePath: '/repo/a.txt', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-before', '+after'] }] }],
  moreFiles: 1,
  changedFiles: ['/repo/a.txt', '/repo/logo.png'],
}

function resultOf(toolName: string, toolUseResult: unknown, source = 'user', parentToolUseId: string | null = null) {
  const events: AgentEvent[] = []
  const mapper = createClaudeAgentEventMapper({ messageId: 'm1', emit: event => events.push(event) })
  mapper.apply({ type: 'assistant', parent_tool_use_id: parentToolUseId,
    message: { content: [{ type: 'tool_use', id: 'tool-1', name: toolName, input: {} }] } })
  mapper.apply({ type: source, parent_tool_use_id: parentToolUseId, tool_use_result: toolUseResult,
    ...(source === 'user'
      ? { message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'done' }] } }
      : { preceding_tool_use_ids: ['tool-1'], summary: 'done' }),
  })
  const result = events.find(event => event.type === 'content_delta' && event.delta.type === 'tool_result')
  if (result?.type !== 'content_delta' || result.delta.type !== 'tool_result') throw new Error('Missing tool result')
  return result.delta
}

describe('Claude Bash file changes', () => {
  it.each([
    ['user', null],
    ['user', 'parent-1'],
    ['tool_use_summary', null],
    ['tool_use_summary', 'parent-1'],
  ] as const)('preserves diffs from %s with parent %s', (source, parentToolUseId) => {
    expect(resultOf('Bash', { stdout: 'done', bashEditDiff }, source, parentToolUseId)).toEqual({
      type: 'tool_result', toolUseId: 'tool-1', summary: 'done', parentToolUseId, bashEditDiff,
    })
  })

  it('preserves an explicit skipped diff so the UI can explain missing details', () => {
    const skipped = { files: [], moreFiles: 0, skipped: true }
    expect(resultOf('Bash', { bashEditDiff: skipped })).toHaveProperty('bashEditDiff', skipped)
  })

  it.each([
    undefined,
    'Error: Exit code 1',
    { bashEditDiff: { files: 'invalid' } },
    { bashEditDiff: { files: [], moreFiles: 0 } },
  ])('omits absent, malformed or empty diffs: %j', toolUseResult => {
    expect(resultOf('Bash', toolUseResult)).not.toHaveProperty('bashEditDiff')
  })

  it('does not treat another tool result as Bash edits', () => {
    expect(resultOf('Read', { bashEditDiff })).not.toHaveProperty('bashEditDiff')
  })
})
