import type { AgentEvent } from '@superone/shared/agent-types'
import { trace, traceEnabled } from '../agent/event-trace'
import type { SessionEventHub } from './session-event-hub'

export interface RecordedSession {
  readonly snapshot: { readonly status: string }
  getPendingInteractions(): AgentEvent[]
  getUiSettings(): unknown
  getReplayEvents(): AgentEvent[]
}

/**
 * Dev recordings of what entered the hub (`hub.event`) and, for session
 * events, the session's observable state right after it (`session.state`):
 * status, pending interactions, settings, and the replayed state (queue,
 * todos, goal, catalogs). Stream profile goldens and the read-model shadow
 * comparison are built from these rows.
 */
export function recordHubEvents(hub: SessionEventHub, getSession: (sessionId: string) => RecordedSession | undefined): () => void {
  return hub.subscribe({
    name: 'recorder',
    sources: ['session', 'environment', 'draft', 'list', 'presence', 'settings', 'remote-node', 'remote-update'],
    replay: true,
    deliver: ({ event, source, sessionId, replay }) => {
      if (!traceEnabled()) return
      trace('hub.event', event.type, { source, sessionId, replay: replay === true, event }, sessionId)
      if (source !== 'session' || !sessionId) return
      const session = getSession(sessionId)
      if (!session) return
      trace('session.state', event.type, {
        sessionId,
        status: session.snapshot.status,
        pending: session.getPendingInteractions(),
        settings: session.getUiSettings(),
        replay: session.getReplayEvents(),
      }, sessionId)
    },
  })
}
