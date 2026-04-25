import type { AgentEvent } from '../../shared/agent-types'
import type { SessionManager } from '../session/types'

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
    if (!session) return
    const targets = new Set<string>(session.subscribers)
    if (session.owner.kind === 'remote') targets.add(session.owner.deviceId)
    if (targets.size === 0) return
    await this.transport.sendAgentEvent(event, [...targets])
  }
}
