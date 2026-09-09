import type { AgentEvent } from '@superone/shared/agent-types'

/** Host confirmations do not live in a harness backend's pending-request map. */
const pending = new WeakMap<object, Map<string, AgentEvent>>()

export function trackHostInteraction(session: object, event: AgentEvent): void {
  if (event.type === 'permission_request' || event.type === 'ask_user_question' || event.type === 'plan_approval') {
    let entries = pending.get(session)
    if (!entries) { entries = new Map(); pending.set(session, entries) }
    entries.set(event.request.requestId, event)
  } else if (event.type === 'interaction_resolved') {
    pending.get(session)?.delete(event.requestId)
  }
}

export function hostPendingInteractions(session: object): AgentEvent[] {
  return [...(pending.get(session)?.values() ?? [])]
}
