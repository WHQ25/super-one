import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@superone/shared/agent-types'
import { workflowRunRows } from './workflow-runs'

const script = `export const meta = {
  name: 'review-changes',
  description: 'Review changed files across dimensions, verify each finding',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}
`

const toolUse = (toolUseId: string, input: Record<string, unknown>): ContentBlock =>
  ({ type: 'tool_use', toolName: 'Workflow', toolUseId, input: JSON.stringify(input) }) as ContentBlock

const toolResult = (toolUseId: string, isError = false): ContentBlock =>
  ({ type: 'tool_result', toolUseId, summary: 'done', isError }) as ContentBlock

describe('workflowRunRows', () => {
  it('reads the name, intent and phases out of the script it ran', () => {
    const [row] = workflowRunRows([{ content: [toolUse('t1', { script })] }])
    expect(row).toMatchObject({
      name: 'review-changes',
      description: 'Review changed files across dimensions, verify each finding',
      phases: ['Review', 'Verify'],
    })
  })

  it('separates a run still going from one that finished or failed', () => {
    const rows = workflowRunRows([
      { content: [toolUse('t1', { script }), toolUse('t2', { script }), toolUse('t3', { script })] },
      { content: [toolResult('t2'), toolResult('t3', true)] },
    ])
    expect(rows.map((row) => row.status).sort()).toEqual(['done', 'failed', 'running'])
  })

  it('puts the newest run first, because that is the one still in question', () => {
    const rows = workflowRunRows([
      { content: [toolUse('t1', { name: 'first' })] },
      { content: [toolUse('t2', { name: 'second' })] },
    ])
    expect(rows.map((row) => row.name)).toEqual(['second', 'first'])
  })

  it('leaves out an authoring smoke check, which is not a run', () => {
    const rows = workflowRunRows([{ content: [toolUse('t1', { script, validate_only: true })] }])
    expect(rows).toEqual([])
  })

  it('falls back to the script it was launched from when there is no meta', () => {
    const rows = workflowRunRows([{ content: [toolUse('t1', { script_path: '/work/.grok/workflows/wf_1/audit.rhai' })] }])
    expect(rows[0]?.name).toBe('audit')
  })

  it('ignores every other tool in the transcript', () => {
    const other = { type: 'tool_use', toolName: 'Bash', toolUseId: 't9', input: '{}' } as ContentBlock
    expect(workflowRunRows([{ content: [other] }])).toEqual([])
  })
})
