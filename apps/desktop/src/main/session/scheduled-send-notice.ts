import type { ScheduledSend } from '@superone/shared/agent-types'
import type { SessionEventHub } from '../stream/session-event-hub'

/** Phones consume workspace notices separately from the durable transcript stream. */
export function publishScheduledSendNotice(hub: SessionEventHub, sessionId: string, scheduled: ScheduledSend | null, delivered: boolean): void {
  hub.publish({ source: 'list', event: { type: 'scheduled_send_changed', sessionId, scheduled, delivered } })
}
