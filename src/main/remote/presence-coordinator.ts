import type { AgentEvent } from '../../shared/agent-types'
import type { Session, SessionLeaveReason, SessionLifecycleEvent } from '../session/types'
import log from '../logger'

export interface PresenceTransport {
  broadcastToRenderer(event: AgentEvent): void
  sendToMobile(event: Record<string, unknown>, targetDeviceIds?: string[]): void | Promise<void>
}

export interface PresenceSessionSource {
  onSession(handler: (session: Session) => void): () => void
}

export class PresenceCoordinator {
  private unsubBySession = new Map<string, () => void>()
  private detachSource: () => void

  constructor(source: PresenceSessionSource, private readonly transport: PresenceTransport) {
    this.detachSource = source.onSession((session) => this.attach(session))
  }

  private notifyMobileLeave(sessionId: string, deviceId: string, reason: SessionLeaveReason | undefined): void {
    if (reason === 'desktop_kick') {
      void this.transport.sendToMobile({ type: 'session_kicked', sessionId }, [deviceId])
    } else if (reason === 'session_closed') {
      void this.transport.sendToMobile({ type: 'session_closed', sessionId }, [deviceId])
    }
  }

  dispose(): void {
    try { this.detachSource() } catch { /* ignore */ }
    for (const unsub of this.unsubBySession.values()) {
      try { unsub() } catch { /* ignore */ }
    }
    this.unsubBySession.clear()
  }

  private attach(session: Session): void {
    if (this.unsubBySession.has(session.id)) return
    const unsub = session.onLifecycle((evt) => this.handle(session, evt))
    this.unsubBySession.set(session.id, unsub)
  }

  private handle(session: Session, evt: SessionLifecycleEvent): void {
    const sessionId = session.id
    const projectPath = session.projectPath
    switch (evt.type) {
      case 'owner_changed': {
        if (evt.previous.kind === 'local' && evt.current.kind === 'remote') {
          this.transport.broadcastToRenderer({
            type: 'remote_session_start',
            remoteProjectPath: projectPath,
            remoteSessionId: sessionId,
            harnessId: session.snapshot.harnessId,
          })
        } else if (evt.previous.kind === 'remote' && evt.current.kind === 'local') {
          this.transport.broadcastToRenderer({
            type: 'remote_session_end',
            remoteProjectPath: projectPath,
            remoteSessionId: sessionId,
          })
          this.notifyMobileLeave(sessionId, evt.previous.deviceId, evt.reason)
        } else if (
          evt.previous.kind === 'remote' && evt.current.kind === 'remote' &&
          evt.previous.deviceId !== evt.current.deviceId
        ) {
          this.transport.broadcastToRenderer({
            type: 'remote_session_start',
            remoteProjectPath: projectPath,
            remoteSessionId: sessionId,
            harnessId: session.snapshot.harnessId,
          })
          this.notifyMobileLeave(sessionId, evt.previous.deviceId, evt.reason)
        }
        return
      }
      case 'subscriber_added':
        this.transport.broadcastToRenderer({
          type: 'remote_session_start',
          remoteProjectPath: projectPath,
          remoteSessionId: sessionId,
          isSubscribe: true,
          harnessId: session.snapshot.harnessId,
        })
        return
      case 'subscriber_removed':
        this.transport.broadcastToRenderer({
          type: 'remote_session_end',
          remoteProjectPath: projectPath,
          remoteSessionId: sessionId,
          isSubscribe: true,
        })
        this.notifyMobileLeave(sessionId, evt.deviceId, evt.reason)
        return
      case 'closed': {
        const unsub = this.unsubBySession.get(sessionId)
        if (unsub) {
          try { unsub() } catch (err) { log.debug('[PresenceCoordinator] unsub error:', err) }
          this.unsubBySession.delete(sessionId)
        }
        return
      }
    }
  }
}
