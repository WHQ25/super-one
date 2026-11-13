import { describe, expect, it } from 'vitest'
import { openNodeDatabase } from '@superone/runtime/db'
import { EventLog } from '@superone/runtime/session'
import { compactEnvironmentEvents } from '@superone/runtime/session/event-log-compact'
import { SESSION_DURABLE_EVENT } from '@superone/shared/environment'
import type { Session } from '../session/types'
import { DESKTOP_EVENT_RETENTION_MS } from './desktop-domain'
import { reconcileRunsAfterRestart } from './reconcile-runs'

describe('desktop node.db event compaction', () => {
  it('purges deleted sessions, trims >24h idle history while preserving sessionVersion and restart reconciliation, and skips busy sessions', () => {
    const db = openNodeDatabase(':memory:')
    const events = new EventLog(db, 'env-desktop')

    events.appendSession({
      sessionId: 'settled',
      eventType: SESSION_DURABLE_EVENT.agentEvent,
      payload: { event: { type: 'status_change', status: 'streaming' } },
    })
    events.appendSession({
      sessionId: 'settled',
      eventType: SESSION_DURABLE_EVENT.tagsChanged,
      payload: { tags: ['draft'] },
    })
    events.appendSession({
      sessionId: 'settled',
      eventType: SESSION_DURABLE_EVENT.agentEvent,
      payload: { event: { type: 'status_change', status: 'idle' } },
    })
    const settledLast = events.appendSession({
      sessionId: 'settled',
      eventType: SESSION_DURABLE_EVENT.renamed,
      payload: { title: 'Done' },
    })

    events.appendSession({
      sessionId: 'crashed',
      eventType: SESSION_DURABLE_EVENT.agentEvent,
      payload: { event: { type: 'status_change', status: 'streaming' } },
    })
    events.appendSession({
      sessionId: 'crashed',
      eventType: SESSION_DURABLE_EVENT.renamed,
      payload: { title: 'Mid-turn' },
    })

    events.appendSession({
      sessionId: 'busy',
      eventType: SESSION_DURABLE_EVENT.renamed,
      payload: { title: 'Still active' },
    })

    const deletedLast = events.appendSession({
      sessionId: 'deleted',
      eventType: SESSION_DURABLE_EVENT.created,
      payload: { title: 'Removed from superone.db' },
    })

    const futureNow = Date.now() + 2 * DESKTOP_EVENT_RETENTION_MS
    const known = new Set(['settled', 'crashed', 'busy'])
    const result = compactEnvironmentEvents(db, {
      externalSessionIds: [...known],
      busySessionIds: ['busy'],
      retainWindowMs: DESKTOP_EVENT_RETENTION_MS,
      now: futureNow,
    })
    events.syncAfterCompact(known)

    expect(result.removedRows).toBe(3)
    expect(result.floor).toBe(deletedLast.sequence)
    expect(events.headSequence()).toBe(deletedLast.sequence)
    expect(events.listAfter(deletedLast.sequence)).toEqual([])

    const remainingBySession = (sessionId: string) =>
      db
        .prepare('SELECT sequence, session_version, event_type FROM environment_events WHERE aggregate_id = ? ORDER BY sequence ASC')
        .all(sessionId) as Array<{ sequence: number; session_version: number; event_type: string }>

    expect(remainingBySession('deleted')).toEqual([])
    expect(remainingBySession('busy')).toHaveLength(1)
    expect(remainingBySession('settled').map((r) => r.session_version)).toEqual([3, settledLast.sessionVersion!])

    const appended = events.appendSession({
      sessionId: 'settled',
      eventType: SESSION_DURABLE_EVENT.tagsChanged,
      payload: { tags: ['ok'] },
    })
    expect(appended.sessionVersion).toBe(settledLast.sessionVersion! + 1)

    const restartedEvents = new EventLog(db, 'env-desktop')
    reconcileRunsAfterRestart({
      db,
      events: restartedEvents,
      sessions: {
        getSession: (id) => (id === 'busy' ? ({ activityStatus: () => 'streaming' } as unknown as Session) : null),
      },
    })
    const reconciledIds = db
      .prepare("SELECT aggregate_id FROM environment_events WHERE event_type = 'session.reconciled'")
      .all() as Array<{ aggregate_id: string }>
    expect(reconciledIds.map((r) => r.aggregate_id)).toEqual(['crashed'])
    db.close()
  })
})
