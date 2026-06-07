import type { Session, SessionLifecycleEvent } from '../session/types'
import type { PresenceSessionSource } from './presence-coordinator'
import log from '../logger'

export interface MobileShareToolControl {
  enable(sessionId: string): void
  disable(sessionId: string): void
}

export class MobileShareToolCoordinator {
  private unsubBySession = new Map<string, () => void>()
  private detachSource: () => void

  constructor(source: PresenceSessionSource, private readonly control: MobileShareToolControl) {
    this.detachSource = source.onSession((session) => this.attach(session))
  }

  private attach(session: Session): void {
    if (this.unsubBySession.has(session.id)) return
    const unsub = session.onLifecycle((evt) => this.handle(session, evt))
    this.unsubBySession.set(session.id, unsub)
  }

  private handle(session: Session, evt: SessionLifecycleEvent): void {
    switch (evt.type) {
      case 'subscriber_added':
        if (session.subscribers.size === 1) this.control.enable(session.id)
        return
      case 'subscriber_removed':
        if (session.subscribers.size === 0) this.control.disable(session.id)
        return
      case 'closed': {
        const unsub = this.unsubBySession.get(session.id)
        if (unsub) {
          try { unsub() } catch (err) { log.debug('[MobileShareToolCoordinator] unsub error:', err) }
          this.unsubBySession.delete(session.id)
        }
        this.control.disable(session.id)
        return
      }
    }
  }

  dispose(): void {
    try { this.detachSource() } catch { /* ignore */ }
    for (const unsub of this.unsubBySession.values()) {
      try { unsub() } catch { /* ignore */ }
    }
    this.unsubBySession.clear()
  }
}
