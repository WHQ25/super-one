import type { AgentEvent } from '@superone/shared/agent-types'
import type { Session, SessionLifecycleEvent } from '../session/types'

export interface PresenceTransport { broadcastToRenderer(event: AgentEvent): void }
export interface PresenceSessionSource { onSession(handler: (session: Session) => void): () => void }

/** Renderer presence is an authority projection; following a transcript never locks its composer. */
export class PresenceCoordinator {
  private readonly unsubBySession = new Map<string, () => void>()
  private readonly detachSource: () => void
  /** The paired name of a controller desktop holding a lease; null for this desktop's own holders. */
  private controllerLabel: (holderClientId: string) => string | null = () => null
  constructor(source: PresenceSessionSource, private readonly transport: PresenceTransport) {
    this.detachSource = source.onSession(session => this.attach(session))
  }
  /** Name controller desktops' leases once this desktop's domain (and its pairings) is open. */
  labelControllers(label: (holderClientId: string) => string | null): void { this.controllerLabel = label }
  dispose(): void {
    this.detachSource()
    for (const unsub of this.unsubBySession.values()) unsub()
    this.unsubBySession.clear()
  }
  private attach(session: Session): void {
    if (this.unsubBySession.has(session.id)) return
    this.unsubBySession.set(session.id, session.onLifecycle(event => this.handle(session, event)))
    if (session.lease.current) this.publish(session, session.lease.current)
  }
  private publish(session: Session, lease: import('@superone/shared/environment').ControlLease | null): void {
    const controllerLabel = lease && this.controllerLabel(lease.holderClientId)
    this.transport.broadcastToRenderer({ type: 'session_control_changed', sessionId: session.id,
      projectPath: session.projectPath, lease, ...(controllerLabel ? { controllerLabel } : {}), harnessId: session.snapshot.harnessId,
      acpAgentId: session.snapshot.acpAgentId, worktreePath: session.snapshot.worktreePath, gitBranch: session.snapshot.gitBranch })
  }
  private handle(session: Session, event: SessionLifecycleEvent): void {
    if (event.type === 'control_changed') this.publish(session, event.lease)
    else {
      this.unsubBySession.get(session.id)?.()
      this.unsubBySession.delete(session.id)
    }
  }
}
