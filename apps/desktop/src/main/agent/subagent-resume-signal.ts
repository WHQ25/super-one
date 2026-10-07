import type { AgentEvent } from '@superone/shared/agent-types'

interface AgentTask {
  toolUseId: string
  description: string
}

/**
 * Keep every run of a subagent on its Agent block. A SendMessage resume streams
 * the resumed output under the original Agent id, but the SDK names the
 * SendMessage call as the `tool_use_id` of that run's task events. Those events
 * are re-keyed to the Agent block, so every surface — including a remote shell
 * that never sees the output behind the card — shows the card running and then
 * finished again.
 *
 * A CLI that does not register the resumed run gets a background `task_started`
 * before its first resumed frame instead. Only content that follows a
 * SendMessage call counts, so a straggling child frame after the notification
 * cannot reopen a card that no notification closes.
 */
export function withSubagentResumeSignal(emit: (event: AgentEvent) => void): (event: AgentEvent) => void {
  const agentsByTask = new Map<string, AgentTask>()
  const finished = new Map<string, AgentTask & { taskId: string; woken: boolean }>()

  return (event) => {
    if (event.type === 'task_started' || event.type === 'task_progress' || event.type === 'task_notification') {
      if (event.type === 'task_started' && event.toolUseId && event.taskType === 'local_agent' && !agentsByTask.has(event.taskId)) {
        agentsByTask.set(event.taskId, { toolUseId: event.toolUseId, description: event.description })
      }
      const agent = agentsByTask.get(event.taskId)
      if (agent && event.type === 'task_started') finished.delete(agent.toolUseId)
      if (agent && event.type === 'task_notification') finished.set(agent.toolUseId, { ...agent, taskId: event.taskId, woken: false })
      if (agent && event.toolUseId !== agent.toolUseId) event = { ...event, toolUseId: agent.toolUseId }
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
