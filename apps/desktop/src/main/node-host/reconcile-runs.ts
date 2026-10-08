import { SESSION_DURABLE_EVENT } from '@superone/shared/environment'
import type { NodeDatabase } from '@superone/runtime/db'
import type { EventLog } from '@superone/runtime/session'
import type { NodeHostSessionManager, NodeHostSessionStore } from './desktop-session-host'

/**
 * A served session whose log ends mid-run while it is not running here (this
 * desktop or its node host restarted under it) gets the `session.reconciled`
 * the CLI node logs on restart, so its controller sees the run end.
 */
export function reconcileRunsAfterRestart(deps: {
  db: NodeDatabase
  events: EventLog
  store: Pick<NodeHostSessionStore, 'list'>
  sessions: Pick<NodeHostSessionManager, 'getSession'>
}): void {
  const lastStatus = deps.db.prepare(`
    SELECT event_type, payload_json FROM environment_events
    WHERE aggregate_type = 'session' AND aggregate_id = ?
      AND (event_type = ? OR (event_type = ? AND json_extract(payload_json, '$.event.type') = 'status_change'))
    ORDER BY sequence DESC LIMIT 1
  `)
  for (const row of deps.store.list()) {
    const last = lastStatus.get(row.sessionId, SESSION_DURABLE_EVENT.reconciled, SESSION_DURABLE_EVENT.agentEvent) as
      | { event_type: string; payload_json: string }
      | undefined
    if (!last || last.event_type !== SESSION_DURABLE_EVENT.agentEvent) continue
    const status = (JSON.parse(last.payload_json) as { event?: { status?: string } }).event?.status
    if (status !== 'streaming' && status !== 'background') continue
    const activity = deps.sessions.getSession(row.sessionId)?.activityStatus()
    if (activity === 'streaming' || activity === 'background') continue
    deps.events.appendSession({
      sessionId: row.sessionId,
      eventType: SESSION_DURABLE_EVENT.reconciled,
      payload: { status: 'interrupted', reason: 'node_restart', pendingInteraction: null },
    })
  }
}
