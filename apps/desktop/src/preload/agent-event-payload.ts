import type { AgentEvent } from '@superone/shared/agent-types'

export function forEachAgentEventPayload(
  payload: AgentEvent | AgentEvent[],
  callback: (event: AgentEvent) => void,
): void {
  if (Array.isArray(payload)) {
    for (const event of payload) callback(event)
    return
  }
  callback(payload)
}
