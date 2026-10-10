import { describe, expect, it } from 'vitest'
import { openNodeDatabase } from '@superone/runtime/db'
import { EventLog } from '@superone/runtime/session'
import type { Session } from '../session/types'
import { reconcileRunsAfterRestart } from './reconcile-runs'

function setup(live: Record<string, string> = {}) {
  const db = openNodeDatabase(':memory:')
  const events = new EventLog(db, 'env-b')
  const status = (sessionId: string, value: string) =>
    events.appendSession({ sessionId, eventType: 'session.agent_event', payload: { event: { type: 'status_change', status: value } } })
  const reconcile = () => reconcileRunsAfterRestart({
    db,
    events,
    sessions: { getSession: (id) => (live[id] ? ({ activityStatus: () => live[id] } as unknown as Session) : null) },
  })
  const reconciled = () => events.listAfter('0').filter((e) => e.eventType === 'session.reconciled').map((e) => e.aggregateId)
  return { status, reconcile, reconciled, events }
}

describe('reconcileRunsAfterRestart', () => {
  it('logs the end of runs the restart cut off, once', () => {
    const node = setup({ live: 'streaming' })
    node.status('running', 'streaming')
    node.status('settled', 'streaming')
    node.status('settled', 'idle')
    node.status('live', 'streaming')
    node.reconcile()
    expect(node.reconciled()).toEqual(['running'])
    expect(node.events.listAfter('0').at(-1)!.payload).toEqual({ status: 'interrupted', reason: 'node_restart', pendingInteraction: null })
    node.reconcile()
    expect(node.reconciled()).toEqual(['running'])
  })
})
