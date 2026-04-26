import type { AgentEvent } from '../../shared/agent-types'
import type { Session, SessionLifecycleEvent } from '../session/types'
import log from '../logger'

export interface PresenceTransport {
  broadcastToRenderer(event: AgentEvent): void
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
        const wentRemote = evt.previous.kind === 'local' && evt.current.kind === 'remote'
        const wentLocal = evt.previous.kind === 'remote' && evt.current.kind === 'local'
        const swappedRemote =
          evt.previous.kind === 'remote' && evt.current.kind === 'remote' &&
          evt.previous.deviceId !== evt.current.deviceId
        if (wentRemote) {
          this.transport.broadcastToRenderer({
            type: 'remote_session_start',
            remoteProjectPath: projectPath,
            remoteSessionId: sessionId,
          })
        } else if (wentLocal) {
          this.transport.broadcastToRenderer({
            type: 'remote_session_end',
            remoteProjectPath: projectPath,
            remoteSessionId: sessionId,
          })
        } else if (swappedRemote) {
          this.transport.broadcastToRenderer({
            type: 'remote_session_start',
            remoteProjectPath: projectPath,
            remoteSessionId: sessionId,
          })
        }
        return
      }
      case 'subscriber_added':
        this.transport.broadcastToRenderer({
          type: 'remote_session_start',
          remoteProjectPath: projectPath,
          remoteSessionId: sessionId,
          isSubscribe: true,
        })
        return
      case 'subscriber_removed':
        this.transport.broadcastToRenderer({
          type: 'remote_session_end',
          remoteProjectPath: projectPath,
          remoteSessionId: sessionId,
          isSubscribe: true,
        })
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
