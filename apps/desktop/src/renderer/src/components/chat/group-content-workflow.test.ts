/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest'
import type { ContentBlock } from '@superone/shared/agent-types'
import { groupContent } from './ChatMessage'

function workflowTool(
  id: string,
  input: Record<string, unknown>,
): ContentBlock & { type: 'tool_use' } {
  return {
    type: 'tool_use',
    toolUseId: id,
    toolName: 'Workflow',
    input: JSON.stringify(input),
    status: 'complete',
  }
}

function toolResult(id: string, summary: string): ContentBlock {
  return {
    type: 'tool_result',
    toolUseId: id,
    summary,
    isError: false,
  }
}

describe('groupContent — Workflow smoke-check vs live run', () => {
  it('routes validate_only Workflow to a normal block (not workflow segment)', () => {
    const content: ContentBlock[] = [
      workflowTool('smoke-1', {
        script: 'let meta = #{ name: "mobile-adapt" };',
        validate_only: true,
      }),
      toolResult('smoke-1', 'ok: smoke-check passed'),
    ]
    const { segments } = groupContent(content, [])
    expect(segments.map((s) => s.kind)).toEqual(['block', 'block'])
    expect(segments.some((s) => s.kind === 'workflow')).toBe(false)
  })

  it('routes live Workflow tool_use into a workflow segment with result attached', () => {
    const content: ContentBlock[] = [
      workflowTool('live-1', { name: 'review-changes' }),
      toolResult('live-1', JSON.stringify({ run_id: 'wf-1', task_id: 'wf-1' })),
    ]
    const { segments } = groupContent(content, [])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('workflow')
    if (segments[0].kind !== 'workflow') return
    expect(segments[0].toolBlock.toolUseId).toBe('live-1')
    expect(segments[0].resultBlock?.type).toBe('tool_result')
  })
})
