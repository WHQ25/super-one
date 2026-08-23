import { describe, expect, it, vi } from 'vitest'
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
