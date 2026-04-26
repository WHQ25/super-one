import type { AgentEvent } from '../../shared/agent-types'
import type { SessionManager } from '../session/types'
import { trace } from '../agent/event-trace'

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
    await this.transport.sendAgentEvent(event, [...targets])
  }
}
