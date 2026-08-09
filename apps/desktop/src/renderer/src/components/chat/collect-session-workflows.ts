import type { ContentBlock } from '@superone/shared/agent-types'
import { isWorkflowSmokeCheck } from './workflow-utils'

export interface SessionWorkflowItem {
  id: string
  toolBlock: ContentBlock & { type: 'tool_use' }
  resultBlock?: ContentBlock & { type: 'tool_result' }
}

/**
 * Collect live Workflow tool runs from the session transcript (newest first).
 * Excludes authoring smoke-checks (`validate_only`).
 */
export function collectSessionWorkflows(
  messages: Array<{ content: ContentBlock[] }>,
): SessionWorkflowItem[] {
  const results = new Map<string, ContentBlock & { type: 'tool_result' }>()
  const items: SessionWorkflowItem[] = []

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        results.set(block.toolUseId, block)
      }
    }
  }

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'tool_use') continue
      if (block.toolName !== 'Workflow') continue
      if (isWorkflowSmokeCheck(block.input)) continue
      items.push({
        id: block.toolUseId,
        toolBlock: block,
        resultBlock: results.get(block.toolUseId),
      })
    }
  }

  // Newest first so the popup can default-expand index 0.
  return items.reverse()
}
