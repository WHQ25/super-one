import type { ContentBlock } from '@superone/shared/agent-types'
import { collectSessionWorkflows } from '@superone/chat-view/presenters/collect-session-workflows'
import { parseWorkflowInput, workflowToolTargetLabel } from '@superone/chat-view/presenters/workflow-utils'

export type WorkflowRunRow = {
  id: string
  /** The workflow's own name, or the script it was launched from. */
  name: string
  /** One line of what it set out to do. */
  description: string
  status: 'running' | 'done' | 'failed'
  /** Phase titles the script declared, in order. */
  phases: string[]
}

function runStatus(result?: ContentBlock & { type: 'tool_result' }): WorkflowRunRow['status'] {
  if (!result) return 'running'
  return result.isError ? 'failed' : 'done'
}

/**
 * Workflow runs in this session, newest first.
 *
 * A workflow can spawn dozens of agents over many minutes, and once it has
 * scrolled out of the transcript there is no other way to ask what it is doing.
 * The desktop popup renders the full blocks; a phone gets what fits — name,
 * intent, phases and whether it is still going.
 */
export function workflowRunRows(messages: readonly { content: ContentBlock[] }[]): WorkflowRunRow[] {
  return collectSessionWorkflows([...messages]).map((item) => {
    const meta = parseWorkflowInput(item.toolBlock.input)
    return {
      id: item.id,
      name: meta.name || workflowToolTargetLabel(item.toolBlock.input) || 'Workflow',
      description: meta.description,
      status: runStatus(item.resultBlock),
      phases: meta.phases.map((phase) => phase.title),
    }
  })
}
