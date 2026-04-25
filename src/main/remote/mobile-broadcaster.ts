import type { AgentEvent } from '../../shared/agent-types'
import type { SessionManager } from '../session/types'

export interface MobileTransport {
  broadcastAgentEvent(event: AgentEvent): Promise<void>
}

export class MobileBroadcaster {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly transport: MobileTransport,
  ) {}

  async broadcast(event: AgentEvent): Promise<void> {
    if (!this.shouldBroadcast(event)) return
    await this.transport.broadcastAgentEvent(event)
  }

  private shouldBroadcast(event: AgentEvent): boolean {
    if (!event.sessionId) return true
    const session = this.sessionManager.getSession(event.sessionId)
    if (!session) return false
    return session.owner.kind === 'remote' || session.subscribers.size > 0
  }
}
