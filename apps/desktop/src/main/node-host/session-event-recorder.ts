import type { EventLog } from '@superone/runtime/session'
import type { Session } from '../session/types'
import log from '../logger'
import { durableEventOf, type NodeHostSessionManager } from './desktop-session-host'

/**
 * Records every session of this desktop in the domain's event log, once, for
 * every client that reads it: the window, phones and controller desktops.
 */
export class SessionEventRecorder {
  private readonly recording = new WeakSet<Session>()
  private readonly seen = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void

  constructor(sessions: NodeHostSessionManager, private readonly events: EventLog) {
    this.unsubscribe = sessions.onSession((session) => this.adopt(session))
  }

  sessionIds(): ReadonlySet<string> {
    return this.seen
  }

  private adopt(session: Session): void {
    this.seen.add(session.id)
    if (this.recording.has(session)) return
    this.recording.add(session)
    this.listeners.add(session.on((event, replay) => {
      if (replay) return
      try {
        const { eventType, payload } = durableEventOf(event)
        this.events.appendSession({ sessionId: session.id, eventType, payload })
      } catch (err) {
        log.warn('[node-host] event append failed sid=%s: %s', session.id, err instanceof Error ? err.message : String(err))
      }
    }))
  }

  dispose(): void {
    this.unsubscribe()
    for (const off of this.listeners) off()
    this.listeners.clear()
  }
}
