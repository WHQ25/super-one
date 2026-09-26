import type { AgentEvent } from '@superone/shared/agent-types'

interface AgentTask {
  toolUseId: string
  description: string
}

/**
 * Announce a SendMessage resume of a finished subagent as a background
 * `task_started` for its Agent block — the one frame every surface needs to show
 * it running again. The SDK streams the resumed output under the original
 * Agent id but does not register the task again, and a remote shell never sees
 * that output: it lives behind the card. A later SDK registration for the same
 * task makes this a no-op.
 *
 * Only content that follows a SendMessage call counts, so a straggling child
 * frame after the notification cannot reopen a card that no notification closes.
 */
export function withSubagentResumeSignal(emit: (event: AgentEvent) => void): (event: AgentEvent) => void {
  const agentsByTask = new Map<string, AgentTask>()
  const finished = new Map<string, AgentTask & { taskId: string; woken: boolean }>()

  return (event) => {
    if (event.type === 'task_started') {
      if (event.toolUseId && event.taskType === 'local_agent' && !agentsByTask.has(event.taskId)) {
        agentsByTask.set(event.taskId, { toolUseId: event.toolUseId, description: event.description })
      }
      const agent = agentsByTask.get(event.taskId)
      if (agent) finished.delete(agent.toolUseId)
    } else if (event.type === 'task_notification') {
      const agent = agentsByTask.get(event.taskId)
      if (agent) finished.set(agent.toolUseId, { ...agent, taskId: event.taskId, woken: false })
    } else if (event.type === 'content_delta') {
      const delta = event.delta
      if ('toolName' in delta && delta.toolName === 'SendMessage') {
        for (const agent of finished.values()) agent.woken = true
      }
      const parentId = 'parentToolUseId' in delta ? delta.parentToolUseId : null
      const resumed = parentId ? finished.get(parentId) : undefined
      if (resumed?.woken) {
        finished.delete(resumed.toolUseId)
        emit({ type: 'task_started', taskId: resumed.taskId, toolUseId: resumed.toolUseId, description: resumed.description, isBackgrounded: true })
      }
    }
    emit(event)
  }
}
