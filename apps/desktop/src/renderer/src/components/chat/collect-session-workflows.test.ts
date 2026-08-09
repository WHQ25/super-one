import { describe, it, expect } from 'vitest'
import type { ContentBlock } from '@superone/shared/agent-types'
import { collectSessionWorkflows } from './collect-session-workflows'

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

function toolResult(id: string, summary: string): ContentBlock & { type: 'tool_result' } {
  return {
    type: 'tool_result',
    toolUseId: id,
    summary,
    isError: false,
  }
}

describe('collectSessionWorkflows', () => {
  it('returns empty for no workflows', () => {
    expect(collectSessionWorkflows([{ content: [] }])).toEqual([])
  })

  it('skips validate_only smoke checks', () => {
    const messages = [{
      content: [
        workflowTool('smoke', { script: 'x', validate_only: true }),
        toolResult('smoke', 'ok'),
      ],
    }]
    expect(collectSessionWorkflows(messages)).toEqual([])
  })

  it('collects live runs newest-first with result attached', () => {
    const messages = [
      {
        content: [
          workflowTool('wf-old', { name: 'review-changes' }),
          toolResult('wf-old', JSON.stringify({ run_id: 'wf_1' })),
        ],
      },
      {
        content: [
          workflowTool('wf-new', { name: 'deep-research' }),
          toolResult('wf-new', JSON.stringify({ run_id: 'wf_2' })),
        ],
      },
    ]
    const items = collectSessionWorkflows(messages)
    expect(items.map((i) => i.id)).toEqual(['wf-new', 'wf-old'])
    expect(items[0]!.resultBlock?.summary).toContain('wf_2')
    expect(items[1]!.resultBlock?.summary).toContain('wf_1')
  })

  it('includes in-flight workflow without result', () => {
    const messages = [{
      content: [workflowTool('wf-live', { name: 'review-changes' })],
    }]
    const items = collectSessionWorkflows(messages)
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe('wf-live')
    expect(items[0]!.resultBlock).toBeUndefined()
  })
})
