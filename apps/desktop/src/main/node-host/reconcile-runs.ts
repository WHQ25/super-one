import { SESSION_DURABLE_EVENT } from '@superone/shared/environment'
import type { NodeDatabase } from '@superone/runtime/db'
import type { EventLog } from '@superone/runtime/session'
import type { NodeHostSessionManager } from './desktop-session-host'

/**
 * A recorded session whose log ends mid-run while it is not running here
 * (this desktop restarted under it) gets the `session.reconciled` the CLI
 * node logs on restart, so whoever follows it sees the run end.
 */
export function reconcileRunsAfterRestart(deps: {
  db: NodeDatabase
  events: EventLog
  sessions: Pick<NodeHostSessionManager, 'getSession'>
}): void {
  // Each recorded session's last run-state event, in one pass over the log.
  const lastStatuses = deps.db.prepare(`
    WITH status AS (
      SELECT aggregate_id, event_type, payload_json, sequence FROM environment_events
      WHERE aggregate_type = 'session'
        AND (event_type = ? OR (event_type = ? AND json_extract(payload_json, '$.event.type') = 'status_change'))
    )
    SELECT s.aggregate_id, s.event_type, s.payload_json FROM status s
    WHERE s.sequence = (SELECT MAX(sequence) FROM status t WHERE t.aggregate_id = s.aggregate_id)
  `).all(SESSION_DURABLE_EVENT.reconciled, SESSION_DURABLE_EVENT.agentEvent) as Array<{ aggregate_id: string; event_type: string; payload_json: string }>
  for (const last of lastStatuses) {
    if (last.event_type !== SESSION_DURABLE_EVENT.agentEvent) continue
    const status = (JSON.parse(last.payload_json) as { event?: { status?: string } }).event?.status
    if (status !== 'streaming' && status !== 'background') continue
    const activity = deps.sessions.getSession(last.aggregate_id)?.activityStatus()
    if (activity === 'streaming' || activity === 'background') continue
    deps.events.appendSession({
      sessionId: last.aggregate_id,
      eventType: SESSION_DURABLE_EVENT.reconciled,
      payload: { status: 'interrupted', reason: 'node_restart', pendingInteraction: null },
    })
  }
}
