import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'

/** Commit durable rows and late turn metadata without waiting for another turn. */
export function shouldPersistSessionEvent(event: AgentEvent, insertedUserMessage: boolean): boolean {
  return (event.type === 'user_message_appended' && insertedUserMessage)
    || event.type === 'message_complete'
    || event.type === 'message_interrupted'
    || event.type === 'message_error'
    || event.type === 'checkpoint_captured'
    || event.type === 'turn_summary'
    || event.type === 'session_recap'
    || (event.type === 'message_usage'
      && (event.inputTokens > 0 || event.outputTokens > 0 || (event.cacheReadTokens ?? 0) > 0))
}

/**
 * Ids whose message object reference changed (or appeared) between two arrays.
 * Relies on reducers preserving identity for unchanged messages.
 */
export function collectChangedMessageIds(
  prev: readonly ChatMessage[],
  next: readonly ChatMessage[],
): string[] {
  if (prev === next) return []
  const prevById = new Map(prev.map((m) => [m.id, m]))
  const changed: string[] = []
  for (const m of next) {
    const p = prevById.get(m.id)
    if (!p || p !== m) changed.push(m.id)
  }
  return changed
}
