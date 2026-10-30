import { describe, expect, it, vi } from 'vitest'
import { openNodeDatabase } from '../db/database'
import { ControlLeaseService } from '../lease/control-lease'
import { EventLog } from './event-log'
import { createSqliteSessionStore } from './sqlite-session-store'
import {
  SessionRuntime,
  type LeaseGuard,
  type NodeSessionRecord,
  type SessionEventLog,
  type SessionStore,
  type TurnRunner,
} from './session-runtime'

function memoryPorts() {
  const rows = new Map<string, NodeSessionRecord>()
  const store: SessionStore = {
    loadAll: () => [...rows.values()].map((session) => ({
      ...session,
      transcript: session.transcript.map((block) => ({ ...block })),
    })),
    save: (session) => rows.set(session.sessionId, { ...session }),
    delete: (sessionId) => { rows.delete(sessionId) },
  }
  const events: SessionEventLog = {
    headSequence: () => '0',
    epoch: 'test', streamingAfter: () => [], streaming: () => [], onAppend: () => () => {},
    listAfter: () => [],
    appendSession: () => {},
  }
  const leases: LeaseGuard = { assertValid: () => {} }
  return { store, events, leases }
}

function session(overrides?: Partial<NodeSessionRecord>): NodeSessionRecord {
  return {
    sessionId: 's1',
    projectId: 'p1',
    harnessId: 'claude',
    providerId: 'claude',
    title: null,
    status: 'idle',
    transcript: [],
    pendingInteraction: null,
    providerResume: null,
    cwd: null,
    permissionMode: null,
    sandboxMode: null,
    model: null,
    effort: null,
    apiProviderId: null,
    createdAt: 0,
    updatedAt: 0,
    isPinned: false,
    isHidden: false,
    isUserRenamed: false,
    tags: [],
    controllerClientSessionId: null,
    hostActionCapabilityVersion: 0,
    hostActionToolGroups: [],
    alwaysAllowedTools: [],
    ...overrides,
  }
}

function runtimeWithEntries(entries: Array<{
  sessionId: string
  lastActivityAt: number
  busy: boolean
}>, sessions: NodeSessionRecord[] = []) {
  const disposeSession = vi.fn(async (sessionId: string) => {
    const index = entries.findIndex((entry) => entry.sessionId === sessionId)
    if (index >= 0) entries.splice(index, 1)
  })
  const runner = Object.assign(
    (async () => ({ finalText: 'ok' })) as TurnRunner,
    {
      listActiveRuntimes: () => entries.map((entry) => ({ ...entry })),
      disposeSession,
    },
  )
  const { store, events, leases } = memoryPorts()
  for (const record of sessions) store.save(record)
  const runtime = new SessionRuntime(store, events, leases, 'env-reaper', runner, {
    runtimeReaperIntervalMs: 0,
  })
  return { runtime, disposeSession }
}

describe('SessionRuntime settle', () => {
  it('stops an in-flight turn and drops the harness without closing the session', async () => {
    let started!: () => void
    const running = new Promise<void>((resolve) => { started = resolve })
    const interruptSession = vi.fn(async () => {})
    const disposeSession = vi.fn(async () => {})
    const runner = Object.assign((async (input: { signal: AbortSignal }) => {
      started()
      await new Promise<void>((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        if (input.signal.aborted) fail()
        else input.signal.addEventListener('abort', fail, { once: true })
      })
      return { finalText: 'should not finish' }
    }) as TurnRunner, { interruptSession, disposeSession })
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-settle', runner, { runtimeReaperIntervalMs: 0 })
    const created = runtime.create({ projectId: 'p', harnessId: 'claude' })
    try {
      const sent = runtime.send({
        sessionId: created.sessionId,
        text: 'work',
        client: { clientSessionId: 'client-1' },
        leaseId: 'lease-1',
        generation: 'gen-1',
      })
      await running
      expect(runtime.get(created.sessionId)?.status).toBe('streaming')
      runtime.setUiFlags(created.sessionId, { isSettled: true })
      await sent
      await vi.waitFor(() => expect(disposeSession).toHaveBeenCalledWith(created.sessionId))
      const live = runtime.get(created.sessionId)
      expect(live?.isSettled).toBe(true)
      expect(live?.closed).toBeFalsy()
      expect(live?.status).toBe('interrupted')
      expect(interruptSession).not.toHaveBeenCalled()
    } finally {
      await runtime.dispose()
    }
  })

  it('drops an idle harness and leaves a pin-only flag change alone', async () => {
    const interruptSession = vi.fn(async () => {})
    const disposeSession = vi.fn(async () => {})
    const { runtime } = runtimeWithEntries([], [session({ sessionId: 'idle-1', status: 'idle' })])
    const runner = (runtime as unknown as { turnRunner: TurnRunner }).turnRunner
    runner.interruptSession = interruptSession
    runner.disposeSession = disposeSession
    try {
      runtime.setUiFlags('idle-1', { isPinned: true })
      expect(disposeSession).not.toHaveBeenCalled()
      expect(interruptSession).not.toHaveBeenCalled()
      runtime.setUiFlags('idle-1', { isSettled: true })
      expect(runtime.get('idle-1')?.isSettled).toBe(true)
      expect(runtime.get('idle-1')?.closed).toBeFalsy()
      expect(runtime.get('idle-1')?.status).toBe('idle')
      expect(interruptSession).toHaveBeenCalledWith('idle-1')
      expect(disposeSession).toHaveBeenCalledWith('idle-1')
    } finally {
      await runtime.dispose()
    }
  })

  it('settling a parent also settles its spawn child and leaves a link peer', async () => {
    const db = openNodeDatabase(':memory:')
    const runtime = new SessionRuntime(
      createSqliteSessionStore(db),
      new EventLog(db, 'env-settle-children'),
      new ControlLeaseService(db),
      'env-settle-children',
      async () => ({ finalText: 'ok' }),
      { runtimeReaperIntervalMs: 0 },
    )
    try {
      const parent = runtime.create({ projectId: 'p', harnessId: 'claude' })
      const child = runtime.create({ projectId: 'p', harnessId: 'claude' })
      const peer = runtime.create({ projectId: 'p', harnessId: 'claude' })
      const insert = db.prepare(`
        INSERT INTO session_collaboration_grants (
          credential_hash, credential_hint, parent_session_id, child_session_id, agent_id, task, config_json, created_at, kind
        ) VALUES (?, 'hint', ?, ?, 'agent', 'task', '{}', '2026-01-01', ?)
      `)
      insert.run('spawn-grant', parent.sessionId, child.sessionId, 'spawn')
      insert.run('link-grant', parent.sessionId, peer.sessionId, 'link')

      runtime.setUiFlags(parent.sessionId, { isSettled: true })

      expect(runtime.get(parent.sessionId)?.isSettled).toBe(true)
      expect(runtime.get(child.sessionId)?.isSettled).toBe(true)
      expect(runtime.get(peer.sessionId)?.isSettled).toBeFalsy()

      runtime.setUiFlags(parent.sessionId, { isSettled: false })
      expect(runtime.get(parent.sessionId)?.isSettled).toBe(false)
      expect(runtime.get(child.sessionId)?.isSettled).toBe(true)
    } finally {
      await runtime.dispose()
      db.close()
    }
  })
})

describe('SessionRuntime idle harness reaper', () => {
  it('releases only idle runtimes older than the adaptive timeout', async () => {
    const now = 2_000_000
    const entries = [
      { sessionId: 'stale', lastActivityAt: now - 21 * 60_000, busy: false },
      { sessionId: 'fresh', lastActivityAt: now - 19 * 60_000, busy: false },
      { sessionId: 'busy', lastActivityAt: now - 21 * 60_000, busy: true },
    ]
    const { runtime, disposeSession } = runtimeWithEntries(entries)

    await runtime.reapIdleRuntimes(now)

    expect(disposeSession).toHaveBeenCalledTimes(1)
    expect(disposeSession).toHaveBeenCalledWith('stale')
    expect(entries.map((entry) => entry.sessionId)).toEqual(['fresh', 'busy'])
  })

  it('keeps a stale runtime while its session has a pending interaction', async () => {
    const now = 2_000_000
    const entries = [
      { sessionId: 'pending', lastActivityAt: now - 21 * 60_000, busy: false },
    ]
    const pending = session({ sessionId: 'pending' })
    const { runtime, disposeSession } = runtimeWithEntries(entries, [pending])
    const live = (runtime as unknown as { live: Map<string, NodeSessionRecord> }).live
    live.get('pending')!.pendingInteraction = {
      interactionId: 'permission-1',
      kind: 'permission',
      createdAt: now - 60_000,
    }

    await runtime.reapIdleRuntimes(now)

    expect(disposeSession).not.toHaveBeenCalled()
  })

  it('runs the reaper automatically and stops its timer during dispose', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T00:30:00Z'))
    const entries = [{ sessionId: 'stale', lastActivityAt: Date.now() - 21 * 60_000, busy: false }]
    const disposeSession = vi.fn(async () => { entries.length = 0 })
    const runner = Object.assign(
      (async () => ({ finalText: 'ok' })) as TurnRunner,
      {
        listActiveRuntimes: () => entries.map((entry) => ({ ...entry })),
        disposeSession,
      },
    )
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-reaper-timer', runner, {
      runtimeReaperIntervalMs: 1_000,
    })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(disposeSession).toHaveBeenCalledWith('stale')

    await runtime.dispose()
    disposeSession.mockClear()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(disposeSession).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
