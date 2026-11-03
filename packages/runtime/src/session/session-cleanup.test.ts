import { describe, expect, it } from 'vitest'
import { mapNodeSessionEvents } from '@superone/shared/node-session-event-map'
import {
  SessionRuntime,
  createSimulatedTurnRunner,
  type LeaseGuard,
  type NodeSessionRecord,
  type SessionEventLog,
  type SessionStore,
} from './session-runtime'
import { runSessionCleanup } from './session-cleanup'

function harness(opts?: { cleanupConfirmTimeoutMs?: number }) {
  const rows = new Map<string, NodeSessionRecord>()
  const appended: Array<{ sessionId: string; eventType: string; payload: unknown }> = []
  const store: SessionStore = {
    loadAll: () => [...rows.values()],
    save: (session) => {
      rows.set(session.sessionId, {
        ...session,
        transcript: session.transcript.map((block) => ({ ...block })),
        tags: [...(session.tags ?? [])],
      })
    },
    delete: (id) => { rows.delete(id) },
    spawnChildSessionIds: (parentId) =>
      [...rows.values()].filter((row) => row.parentSessionId === parentId).map((row) => row.sessionId),
  }
  const events: SessionEventLog = {
    epoch: 'test',
    headSequence: () => '0',
    listAfter: () => [],
    streamingAfter: () => [],
    streaming: () => [],
    onAppend: () => () => {},
    appendSession: (input) => {
      appended.push({ sessionId: input.sessionId, eventType: input.eventType, payload: input.payload })
      return appended.length
    },
  }
  const leases: LeaseGuard = { assertValid: () => {} }
  const runtime = new SessionRuntime(store, events, leases, 'env-1', createSimulatedTurnRunner({ delayMs: 0 }), {
    runtimeReaperIntervalMs: 0,
    cleanupConfirmTimeoutMs: opts?.cleanupConfirmTimeoutMs,
  })
  return { runtime, rows, appended }
}

const answer = { client: { clientSessionId: 'client-1' }, leaseId: 'lease', generation: '1' }

describe('runSessionCleanup', () => {
  it('settles a node session and its spawn child, and skips self and pinned', async () => {
    const { runtime, rows } = harness()
    const source = runtime.create({ projectId: 'p', title: 'Current' })
    const parent = runtime.create({ projectId: 'p', title: 'Parent' })
    const child = runtime.create({ projectId: 'p', title: 'Child', parentSessionId: parent.sessionId })
    const pinned = runtime.create({ projectId: 'p', title: 'Pinned' })
    runtime.setUiFlags(pinned.sessionId, { isPinned: true })

    const body = await runSessionCleanup(runtime, {
      action: 'settle',
      sessionIds: [source.sessionId, pinned.sessionId, parent.sessionId, 'missing'],
      sourceSessionId: source.sessionId,
    })

    expect(body).toMatchObject({
      status: 'ok',
      action: 'settle',
      affected: [{ id: parent.sessionId, title: 'Parent' }],
      skippedSelf: [source.sessionId],
      skippedPinned: [{ id: pinned.sessionId, title: 'Pinned' }],
    })
    expect(rows.get(parent.sessionId)?.isSettled).toBe(true)
    expect(rows.get(child.sessionId)?.isSettled).toBe(true)
    expect(rows.get(source.sessionId)?.isSettled).not.toBe(true)
    expect(rows.get(pinned.sessionId)?.isSettled).not.toBe(true)
    await runtime.dispose()
  })

  it('reports node ids that are absent instead of pretending they were processed', async () => {
    const { runtime } = harness()
    const source = runtime.create({ projectId: 'p', title: 'Current' })
    const body = await runSessionCleanup(runtime, {
      action: 'unsettle',
      sessionIds: ['not-on-this-node'],
      sourceSessionId: source.sessionId,
    })
    expect(body).toMatchObject({ status: 'ok', message: 'No matching sessions to process.', affected: [] })
    await runtime.dispose()
  })

  it('deletes the target and a hidden child only after the user accepts', async () => {
    const { runtime, rows, appended } = harness()
    const source = runtime.create({ projectId: 'p', title: 'Current' })
    const target = runtime.create({ projectId: 'p', title: 'Gone' })
    const hidden = runtime.create({ projectId: 'p', title: 'Hidden child', parentSessionId: target.sessionId })
    const pinnedChild = runtime.create({ projectId: 'p', title: 'Pinned child', parentSessionId: target.sessionId })
    runtime.setUiFlags(hidden.sessionId, { isHidden: true })
    runtime.setUiFlags(pinnedChild.sessionId, { isPinned: true })

    const pending = runSessionCleanup(runtime, {
      action: 'delete',
      sessionIds: [target.sessionId],
      sourceSessionId: source.sessionId,
    })
    const interaction = runtime.get(source.sessionId)?.pendingInteraction
    expect(interaction?.kind).toBe('session_cleanup_confirm')
    expect(interaction?.sessionCleanupConfirm?.sessions.map((row) => row.id).sort()).toEqual(
      [hidden.sessionId, target.sessionId].sort(),
    )
    const card = mapNodeSessionEvents(
      appended.filter((event) => event.eventType === 'session.permission_requested').map((event) => ({
        eventId: 'e',
        sequence: '1',
        timestamp: 1,
        aggregateType: 'session' as const,
        aggregateId: event.sessionId,
        eventType: event.eventType,
        eventVersion: 1,
        payload: event.payload,
        environmentId: 'env-1',
      })),
      { projectPath: '/work', sessionId: source.sessionId, providerId: 'acp', nowIso: () => '2020-01-01T00:00:00.000Z' },
    )
    expect(card[0]).toMatchObject({
      type: 'permission_request',
      request: { requestKind: 'session_cleanup_confirm', allowAlwaysAllow: false },
    })

    runtime.respondPermission({
      sessionId: source.sessionId,
      interactionId: interaction!.interactionId,
      decision: 'deny',
      ...answer,
    })
    const declined = await pending
    expect(declined).toMatchObject({ status: 'rejected', action: 'delete' })
    expect(rows.has(target.sessionId)).toBe(true)
    expect(rows.has(hidden.sessionId)).toBe(true)

    const again = runSessionCleanup(runtime, {
      action: 'delete',
      sessionIds: [target.sessionId],
      sourceSessionId: source.sessionId,
    })
    const next = runtime.get(source.sessionId)?.pendingInteraction
    runtime.respondPermission({
      sessionId: source.sessionId,
      interactionId: next!.interactionId,
      decision: 'allow',
      ...answer,
    })
    const accepted = await again
    expect(accepted).toMatchObject({
      status: 'ok',
      action: 'delete',
      deleted: expect.arrayContaining([
        { id: target.sessionId, title: 'Gone' },
        { id: hidden.sessionId, title: 'Hidden child' },
      ]),
    })
    expect(rows.has(target.sessionId)).toBe(false)
    expect(rows.has(hidden.sessionId)).toBe(false)
    expect(rows.has(pinnedChild.sessionId)).toBe(true)
    expect(rows.has(source.sessionId)).toBe(true)
    await runtime.dispose()
  })

  it('cancels a delete when the confirm times out and leaves the rows', async () => {
    const { runtime, rows } = harness({ cleanupConfirmTimeoutMs: 20 })
    const source = runtime.create({ projectId: 'p', title: 'Current' })
    const target = runtime.create({ projectId: 'p', title: 'Stay' })
    const body = await runSessionCleanup(runtime, {
      action: 'delete',
      sessionIds: [target.sessionId],
      sourceSessionId: source.sessionId,
    })
    expect(body.status).toBe('cancelled')
    expect(String(body.message)).toMatch(/timed out/)
    expect(rows.has(target.sessionId)).toBe(true)
    await runtime.dispose()
  })

  it('caps candidates before expanding children', async () => {
    const { runtime, rows } = harness()
    const source = runtime.create({ projectId: 'p', title: 'Current' })
    const first = runtime.create({ projectId: 'p', title: 'First' })
    const second = runtime.create({ projectId: 'p', title: 'Second' })
    const child = runtime.create({ projectId: 'p', title: 'Child', parentSessionId: first.sessionId })
    const pending = runSessionCleanup(runtime, {
      action: 'delete',
      sessionIds: [first.sessionId, second.sessionId],
      sourceSessionId: source.sessionId,
      maxDelete: 1,
    })
    const interaction = runtime.get(source.sessionId)?.pendingInteraction
    expect(interaction?.sessionCleanupConfirm?.sessions.map((row) => row.id).sort()).toEqual(
      [child.sessionId, first.sessionId].sort(),
    )
    runtime.respondPermission({
      sessionId: source.sessionId,
      interactionId: interaction!.interactionId,
      decision: 'allow',
      ...answer,
    })
    const body = await pending
    expect(body.omittedDueToMaxDelete).toEqual([second.sessionId])
    expect(rows.has(second.sessionId)).toBe(true)
    expect(rows.has(first.sessionId)).toBe(false)
    expect(rows.has(child.sessionId)).toBe(false)
    await runtime.dispose()
  })
})
