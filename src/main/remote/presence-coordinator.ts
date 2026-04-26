import type { AgentEvent } from '../../shared/agent-types'
import type { Session, SessionLifecycleEvent } from '../session/types'
import log from '../logger'

export interface PresenceTransport {
  broadcastToRenderer(event: AgentEvent): void
  sendToMobile(event: Record<string, unknown>, targetDeviceIds?: string[]): void | Promise<void>
}

export interface PresenceSessionSource {
  onSession(handler: (session: Session) => void): () => void
  forEachSession(fn: (session: Session) => void): void
}

export class PresenceCoordinator {
  private unsubBySession = new Map<string, () => void>()
  private detachSource: () => void

  constructor(private readonly source: PresenceSessionSource, private readonly transport: PresenceTransport) {
    this.detachSource = source.onSession((session) => this.attach(session))
  }

  private isDeviceActiveElsewhere(deviceId: string, exceptSessionId: string): boolean {
    let active = false
    this.source.forEachSession((s) => {
      if (s.id === exceptSessionId) return
      if (s.subscribers.has(deviceId)) active = true
      else if (s.owner.kind === 'remote' && s.owner.deviceId === deviceId) active = true
    })
    return active
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
          })
        } else if (evt.previous.kind === 'remote' && evt.current.kind === 'local') {
          this.transport.broadcastToRenderer({
            type: 'remote_session_end',
            remoteProjectPath: projectPath,
            remoteSessionId: sessionId,
          })
          if (!this.isDeviceActiveElsewhere(evt.previous.deviceId, sessionId)) {
            void this.transport.sendToMobile(
              { type: 'session_disconnected', sessionId },
              [evt.previous.deviceId],
            )
          }
        } else if (
          evt.previous.kind === 'remote' && evt.current.kind === 'remote' &&
          evt.previous.deviceId !== evt.current.deviceId
        ) {
          this.transport.broadcastToRenderer({
            type: 'remote_session_start',
            remoteProjectPath: projectPath,
            remoteSessionId: sessionId,
          })
          if (!this.isDeviceActiveElsewhere(evt.previous.deviceId, sessionId)) {
            void this.transport.sendToMobile(
              { type: 'session_disconnected', sessionId },
              [evt.previous.deviceId],
            )
          }
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
        if (!this.isDeviceActiveElsewhere(evt.deviceId, sessionId)) {
          void this.transport.sendToMobile(
            { type: 'session_disconnected', sessionId },
            [evt.deviceId],
          )
        }
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
