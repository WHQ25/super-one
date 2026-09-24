import { detailUpdates, isProgressiveSession, projectProgressiveEvent } from './progressive-session'
import { takeAttachmentOrigin, withoutAttachmentBytes } from './attachment-echo'
import { SESSION_ACTIVITY_EVENTS } from '@superone/shared/session-activity'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { Session, SessionManager } from '../session/types'
import { trace } from '../agent/event-trace'
import { liveSessionActivity } from './live-session-activity'

export interface MobileTransport {
  sendAgentEvent(event: AgentEvent, targetDeviceIds?: string[]): Promise<void>
}

export class MobileBroadcaster {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly transport: MobileTransport,
  ) {}

  async broadcast(event: AgentEvent): Promise<void> {
    if (!event.sessionId) {
      await this.transport.sendAgentEvent(event)
      return
    }
    const session = this.sessionManager.getSession(event.sessionId)
    if (!session) {
      trace('remote.broadcast', 'drop:no-session', { type: event.type, sessionId: event.sessionId })
      return
    }
    const messages = session.snapshot.messages
    if (!session.ephemeral && SESSION_ACTIVITY_EVENTS.has(event.type)) {
      await this.transport.sendAgentEvent({
        type: 'session_activity',
        activity: liveSessionActivity(session),
        ...(event.type === 'status_change' && event.status === 'idle' ? { completed: true } : {}),
      })
    }
    const targets = new Set<string>(session.subscribers)
    if (session.owner.kind === 'remote') targets.add(session.owner.deviceId)
    if (targets.size === 0) {
      trace('remote.broadcast', 'drop:no-target', {
        type: event.type,
        sessionId: event.sessionId,
        owner: session.owner.kind,
        subscribers: [...session.subscribers],
      })
      return
    }
    trace('remote.broadcast', 'route', { type: event.type, sessionId: event.sessionId, targets: [...targets] })
    // The sender of a message with attachments gets the echo without the bytes.
    const origin = event.type === 'user_message_appended' && event.message.attachments?.length
      ? takeAttachmentOrigin(event.message.id)
      : undefined
    if (origin && targets.has(origin)) {
      targets.delete(origin)
      await this.deliver(withoutAttachmentBytes(event), [origin], session, messages)
    }
    await this.deliver(event, [...targets], session, messages)
  }

  private async deliver(event: AgentEvent, targets: string[], session: Session, messages: readonly ChatMessage[]): Promise<void> {
    const legacy = targets.filter(deviceId => !isProgressiveSession(deviceId, session.id))
    const progressive = targets.filter(deviceId => isProgressiveSession(deviceId, session.id))
    if (legacy.length) await this.transport.sendAgentEvent(event, legacy)
    if (progressive.length) {
      const projected = projectProgressiveEvent(event, messages)
      if (projected) await this.transport.sendAgentEvent(projected, progressive)
      for (const deviceId of progressive) {
        for (const update of detailUpdates(deviceId, session.id, session.snapshot.messages)) {
          await this.transport.sendAgentEvent(update, [deviceId])
        }
      }
    }
  }
}
