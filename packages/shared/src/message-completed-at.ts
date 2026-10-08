import type { AgentEvent } from './agent-types'

/**
 * Put the turn's completion time on a terminal message event. A value the event
 * already carries wins, so a replayed or forwarded event keeps its original time.
 */
export function stampCompletedAt(event: AgentEvent, at: string = new Date().toISOString()): AgentEvent {
  if (
    event.type !== 'message_complete'
    && event.type !== 'message_interrupted'
    && event.type !== 'message_error'
  ) return event
  if (event.metadata?.completedAt) return event
  return { ...event, metadata: { ...event.metadata, completedAt: at } }
}
