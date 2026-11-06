import type { AgentEvent } from './agent-types'

/** A durable provider notice is independent of user turns and session activity. */
export function isSystemNoticeEvent(event: AgentEvent): boolean {
  return event.type === 'user_message_appended'
    && event.message.providerId === 'system'
    && Boolean(event.message.metadata?.systemNotice)
}
