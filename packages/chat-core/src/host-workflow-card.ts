import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import type { ChatCoreSession } from './types'

/** Message id for a slash-launched workflow card. Main's transcript never has this id, so snapshot merge keeps the row. */
export const HOST_WORKFLOW_MESSAGE_PREFIX = 'host-workflow-'

function runIdFromSummary(summary: string | undefined): string | undefined {
  if (!summary) return undefined
  const trimmed = summary.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const runId = parsed.run_id ?? parsed.runId
      if (typeof runId === 'string' && runId.trim()) return runId.trim()
    } catch {
      return undefined
    }
    return undefined
  }
  return trimmed.match(/run_id:\s*(\S+)/i)?.[1]
}

function isSmokeWorkflowInput(input: string): boolean {
  return /"validate_only"\s*:\s*true/.test(input) || /"validateOnly"\s*:\s*true/.test(input)
}

function splitWorkflowDescription(description: string): { name: string; objective: string } {
  const trimmed = description.trim()
  const sep = trimmed.indexOf(': ')
  if (sep <= 0) return { name: trimmed || 'workflow', objective: '' }
  const name = trimmed.slice(0, sep).trim() || 'workflow'
  return { name, objective: trimmed.slice(sep + 2).trim() }
}

function messagesHaveTool(messages: ChatMessage[], toolUseId: string): boolean {
  return messages.some((message) => message.content.some(
    (block) => block.type === 'tool_use' && block.toolUseId === toolUseId,
  ))
}

/**
 * A Workflow tool_use in the current turn that has not reported a run id yet
 * is a model launch. Its own block will render the card; synthesizing another
 * from the early `workflow_updated` (which arrives before the tool result)
 * would duplicate it.
 */
function turnHasUnboundWorkflowTool(messages: ChatMessage[]): boolean {
  let lastUser = -1
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') lastUser = i
  }
  const results: Record<string, string> = {}
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_result') results[block.toolUseId] = block.summary ?? ''
    }
  }
  for (let i = lastUser + 1; i < messages.length; i++) {
    for (const block of messages[i].content) {
      if (block.type !== 'tool_use' || block.toolName !== 'Workflow') continue
      if (isSmokeWorkflowInput(block.input)) continue
      if (!runIdFromSummary(results[block.toolUseId])) return true
    }
  }
  return false
}

function toolNameFor(messages: ChatMessage[], toolUseId: string): string | undefined {
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use' && block.toolUseId === toolUseId) return block.toolName
    }
  }
  return undefined
}

/**
 * Grok slash launches (`/grok-build-parity`, `/workflow <name>`) never emit a
 * `workflow` tool call. Progress arrives only as `workflow_updated` →
 * `task_started` with `taskType: 'workflow'` and no toolUseId. The chat card,
 * status chip, and `/workflows` popup all key off a Workflow tool block, so
 * mint one keyed by the run id.
 *
 * The row uses its own message id. Appending onto the slash-output assistant
 * message loses the blocks when main's snapshot (which never saw them) wins
 * the seq merge.
 */
export function synthesizeHostWorkflowCard(
  session: ChatCoreSession,
  taskId: string,
  description: string,
  now: number,
): ChatMessage[] | null {
  if (messagesHaveTool(session.messages, taskId)) return null
  if (turnHasUnboundWorkflowTool(session.messages)) return null
  const { name, objective } = splitWorkflowDescription(description)
  const toolUse: ContentBlock = {
    type: 'tool_use',
    toolName: 'Workflow',
    toolUseId: taskId,
    input: JSON.stringify({
      name,
      source: { type: 'name', name },
      ...(objective ? { description: objective } : {}),
    }),
    status: 'complete',
    workflowName: name,
    ...(objective ? { workflowDescription: objective } : {}),
  }
  const toolResult: ContentBlock = {
    type: 'tool_result',
    toolUseId: taskId,
    summary: JSON.stringify({ run_id: taskId, task_id: taskId, name }),
  }
  const message: ChatMessage = {
    id: `${HOST_WORKFLOW_MESSAGE_PREFIX}${taskId}`,
    role: 'assistant',
    status: 'complete',
    content: [toolUse, toolResult],
    createdAt: new Date(now).toISOString(),
    providerId: session.sessionProvider ?? session.preferredProvider ?? 'acp',
  }
  return [...session.messages, message]
}

/**
 * Once a real Workflow tool result names this run, the host card is a shadow
 * of that launch. Drop it so the transcript shows one card.
 */
export function dropHostWorkflowShadow(
  messages: ChatMessage[],
  toolUseId: string,
  summary: string | undefined,
): ChatMessage[] | null {
  if (toolNameFor(messages, toolUseId) !== 'Workflow') return null
  const runId = runIdFromSummary(summary)
  if (!runId || runId === toolUseId) return null
  let changed = false
  const next: ChatMessage[] = []
  for (const message of messages) {
    let removed = false
    const content = message.content.filter((block) => {
      const shadow = (block.type === 'tool_use' || block.type === 'tool_result') && block.toolUseId === runId
      if (shadow) removed = true
      return !shadow
    })
    if (!removed) {
      next.push(message)
      continue
    }
    changed = true
    if (content.length === 0 && message.id.startsWith(HOST_WORKFLOW_MESSAGE_PREFIX)) continue
    next.push({ ...message, content })
  }
  return changed ? next : null
}
