/**
 * Host Action channel — store + SessionRuntime API (integration-first, SQLite).
 */
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HOST_ACTION_TOOL_GROUPS,
  type HostActionTerminalResult,
} from '@superone/shared/environment'
import { EventLog } from './event-log'
import { createSqliteHostActionStore } from './host-action-store'
import {
  createSimulatedTurnRunner,
  SessionRuntime,
  type LeaseGuard,
  type NodeSessionRecord,
  type TurnRunner,
} from './session-runtime'
import { createSqliteSessionStore } from './sqlite-session-store'

const dbs: Database.Database[] = []

afterEach(async () => {
  while (dbs.length) {
    const db = dbs.pop()
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
})

function openDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      harness_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL,
      transcript_json TEXT NOT NULL,
      pending_interaction_json TEXT,
      provider_resume TEXT,
      cwd TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      is_user_renamed INTEGER NOT NULL DEFAULT 0,
      controller_client_session_id TEXT,
      host_action_capability_version INTEGER NOT NULL DEFAULT 0,
      host_action_tool_groups_json TEXT NOT NULL DEFAULT '[]',
      always_allowed_tools_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE environment_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      timestamp INTEGER NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      causation_request_id TEXT,
      environment_id TEXT NOT NULL
    );
  `)
  dbs.push(db)
  return db
}

function boot(runner?: TurnRunner) {
  const db = openDb()
  const events = new EventLog(db as never, 'env-ha')
  const leases: LeaseGuard = { assertValid: () => {} }
  const hostActions = createSqliteHostActionStore(db as never)
  const runtime = new SessionRuntime(
    createSqliteSessionStore(db as never),
    events,
    leases,
    'env-ha',
    runner ?? createSimulatedTurnRunner({ delayMs: 5, chunks: ['x'] }),
    { hostActions },
  )
  return { db, events, runtime, hostActions }
}

function createBoundSession(
  runtime: SessionRuntime,
  controller = 'client-A',
): NodeSessionRecord {
  return runtime.create({
    projectId: 'p1',
    harnessId: 'codex',
    controllerClientSessionId: controller,
  })
}

async function holdTurn(
  runtime: SessionRuntime,
  sessionId: string,
  hold: { release?: () => void; released: Promise<void> },
  client = 'client-A',
) {
  await runtime.send({
    sessionId,
    text: 'hold',
    client: { clientSessionId: client },
    leaseId: 'L',
    generation: 'G',
  })
  // send is fire-and-forget; ensure status streaming
  for (let i = 0; i < 50; i++) {
    if (runtime.get(sessionId)?.status === 'streaming') return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('turn did not start')
}

describe('Host Action store', () => {
  it('atomically claims — second claim with same version conflicts', () => {
    const { hostActions } = boot()
    const row = hostActions.create({
      sessionId: 's1',
      controllerClientSessionId: 'c1',
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: { x: 1 },
      replayPolicy: 'safe',
    })
    const a = hostActions.claim({
      actionId: row.actionId,
      expectedVersion: row.version,
      controllerClientSessionId: 'c1',
    })
    expect(a.claimToken).toBeTruthy()
    expect(a.row.state).toBe('claimed')
    expect(() =>
      hostActions.claim({
        actionId: row.actionId,
        expectedVersion: row.version,
        controllerClientSessionId: 'c1',
      }),
    ).toThrow(/conflict|pending/i)
  })

  it('accepts identical terminal response and rejects conflicting payload', () => {
    const { hostActions } = boot()
    const row = hostActions.create({
      sessionId: 's1',
      controllerClientSessionId: 'c1',
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      replayPolicy: 'safe',
    })
    const { claimToken } = hostActions.claim({
      actionId: row.actionId,
      expectedVersion: row.version,
      controllerClientSessionId: 'c1',
    })
    const first = hostActions.respond({
      actionId: row.actionId,
      claimToken,
      controllerClientSessionId: 'c1',
      outcome: 'succeeded',
      result: { tabs: [] },
    })
    expect(first.duplicate).toBe(false)
    expect(first.row.state).toBe('succeeded')

    const second = hostActions.respond({
      actionId: row.actionId,
      claimToken,
      controllerClientSessionId: 'c1',
      outcome: 'succeeded',
      result: { tabs: [] },
    })
    expect(second.duplicate).toBe(true)

    expect(() =>
      hostActions.respond({
        actionId: row.actionId,
        claimToken,
        controllerClientSessionId: 'c1',
        outcome: 'succeeded',
        result: { tabs: [1] },
      }),
    ).toThrow(/conflict/i)
  })

  it('rejects non-controller claim and respond', () => {
    const { hostActions } = boot()
    const row = hostActions.create({
      sessionId: 's1',
      controllerClientSessionId: 'c1',
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: { secret: true },
      replayPolicy: 'safe',
    })
    expect(() =>
      hostActions.claim({
        actionId: row.actionId,
        expectedVersion: row.version,
        controllerClientSessionId: 'other',
      }),
    ).toThrow(/controller|forbidden/i)

    const { claimToken } = hostActions.claim({
      actionId: row.actionId,
      expectedVersion: row.version,
      controllerClientSessionId: 'c1',
    })
    expect(() =>
      hostActions.respond({
        actionId: row.actionId,
        claimToken,
        controllerClientSessionId: 'other',
        outcome: 'succeeded',
        result: {},
      }),
    ).toThrow(/controller|forbidden/i)

    // Poll filters by controller — other sees nothing
    expect(hostActions.listOutstanding('other')).toHaveLength(0)
    expect(hostActions.listOutstanding('c1')).toHaveLength(1)
  })

  it('requeues expired safe claims; cancels expired unsafe claims', () => {
    const { hostActions } = boot()
    const safe = hostActions.create({
      sessionId: 's1',
      controllerClientSessionId: 'c1',
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      replayPolicy: 'safe',
      deadlineMs: 60_000,
    })
    const unsafe = hostActions.create({
      sessionId: 's1',
      controllerClientSessionId: 'c1',
      toolName: 'browser.click',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      replayPolicy: 'unsafe',
      deadlineMs: 60_000,
    })
    hostActions.claim({
      actionId: safe.actionId,
      expectedVersion: safe.version,
      controllerClientSessionId: 'c1',
      claimTtlMs: 1,
    })
    hostActions.claim({
      actionId: unsafe.actionId,
      expectedVersion: unsafe.version,
      controllerClientSessionId: 'c1',
      claimTtlMs: 1,
    })
    const now = Date.now() + 100
    hostActions.reconcileExpired(now)
    expect(hostActions.get(safe.actionId)!.state).toBe('pending')
    expect(hostActions.get(unsafe.actionId)!.state).toBe('cancelled')
  })
})

describe('SessionRuntime host actions', () => {
  it('binds controller at create and rejects different controller claim', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const runner: TurnRunner = async ({ signal }) => {
      await Promise.race([
        held,
        new Promise<void>((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true })),
      ])
      return { finalText: 'done' }
    }
    const { runtime } = boot(runner)
    const session = createBoundSession(runtime, 'client-A')
    expect(session.controllerClientSessionId).toBe('client-A')
    expect(session.hostActionToolGroups).toContain(HOST_ACTION_TOOL_GROUPS.browserRead)
    expect(session.hostActionToolGroups).toContain(HOST_ACTION_TOOL_GROUPS.browserAct)
    expect(session.hostActionToolGroups).toContain(HOST_ACTION_TOOL_GROUPS.superone)
    expect(session.hostActionToolGroups).toContain(HOST_ACTION_TOOL_GROUPS.computer)
    expect(session.hostActionCapabilityVersion).toBe(1)

    await holdTurn(runtime, session.sessionId, { released: held }, 'client-A')

    const wait = runtime.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: { only: 'controller' },
      deadlineMs: 30_000,
    })

    // Let create land
    await new Promise((r) => setTimeout(r, 20))
    const snap = await runtime.pollHostActions({
      controllerClientSessionId: 'client-A',
    })
    expect(snap.outstanding?.length).toBe(1)
    const action = snap.outstanding![0]!

    // Other controller cannot poll args or claim
    const otherSnap = await runtime.pollHostActions({
      controllerClientSessionId: 'client-B',
    })
    expect(otherSnap.outstanding ?? []).toHaveLength(0)

    expect(() =>
      runtime.claimHostAction({
        actionId: action.actionId,
        expectedVersion: action.version,
        controllerClientSessionId: 'client-B',
      }),
    ).toThrow(/controller|forbidden/i)

    const claimed = runtime.claimHostAction({
      actionId: action.actionId,
      expectedVersion: action.version,
      controllerClientSessionId: 'client-A',
    })
    expect(claimed.args).toEqual({ only: 'controller' })

    runtime.respondHostAction({
      actionId: claimed.actionId,
      claimToken: claimed.claimToken,
      controllerClientSessionId: 'client-A',
      outcome: 'succeeded',
      result: { ok: true },
    })
    const terminal = await wait
    expect(terminal.state).toBe('succeeded')
    release()
  })

  it('cancels pending host action on interrupt before claim', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const runner: TurnRunner = async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'))
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        held.then(() => resolve())
      })
      return { finalText: 'done' }
    }
    const { runtime } = boot(runner)
    const session = createBoundSession(runtime)
    await holdTurn(runtime, session.sessionId, { released: held })

    const wait = runtime.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      deadlineMs: 30_000,
    })
    await new Promise((r) => setTimeout(r, 20))

    runtime.interrupt(session.sessionId, { clientSessionId: 'client-A' }, 'L', 'G')
    const terminal = await wait
    expect(terminal.state).toBe('cancelled')
    release()
  })

  it('cancels claimed host action on interrupt during execution', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const runner: TurnRunner = async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'))
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        held.then(() => resolve())
      })
      return { finalText: 'done' }
    }
    const { runtime } = boot(runner)
    const session = createBoundSession(runtime)
    await holdTurn(runtime, session.sessionId, { released: held })

    const wait = runtime.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      deadlineMs: 30_000,
    })
    await new Promise((r) => setTimeout(r, 20))
    const snap = await runtime.pollHostActions({ controllerClientSessionId: 'client-A' })
    const action = snap.outstanding![0]!
    runtime.claimHostAction({
      actionId: action.actionId,
      expectedVersion: action.version,
      controllerClientSessionId: 'client-A',
    })

    runtime.interrupt(session.sessionId, { clientSessionId: 'client-A' }, 'L', 'G')
    const terminal = await wait
    expect(terminal.state).toBe('cancelled')
    // Late respond rejected
    expect(() =>
      runtime.respondHostAction({
        actionId: action.actionId,
        claimToken: 'x',
        controllerClientSessionId: 'client-A',
        outcome: 'succeeded',
        result: {},
      }),
    ).toThrow()
    release()
  })

  it('settles waiters on session close and deadline', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const runner: TurnRunner = async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'))
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        held.then(() => resolve())
      })
      return { finalText: 'done' }
    }
    const { runtime } = boot(runner)
    const session = createBoundSession(runtime)
    await holdTurn(runtime, session.sessionId, { released: held })

    const waitClose = runtime.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      deadlineMs: 30_000,
    })
    await new Promise((r) => setTimeout(r, 15))
    runtime.close(session.sessionId)
    expect((await waitClose).state).toBe('cancelled')

    // New session for deadline
    const session2 = createBoundSession(runtime, 'client-A')
    await holdTurn(runtime, session2.sessionId, { released: held })
    const waitDl = runtime.requestHostAction({
      sessionId: session2.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      deadlineMs: 50,
    })
    const t = await waitDl
    expect(t.state).toBe('cancelled')
    release()
  })

  it('node restart reconciliation cancels outstanding actions', async () => {
    const db = openDb()
    const events = new EventLog(db as never, 'env-ha')
    const leases: LeaseGuard = { assertValid: () => {} }
    const hostActions = createSqliteHostActionStore(db as never)
    const store = createSqliteSessionStore(db as never)

    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const runner: TurnRunner = async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'))
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        held.then(() => resolve())
      })
      return { finalText: 'done' }
    }

    const rt1 = new SessionRuntime(store, events, leases, 'env-ha', runner, { hostActions })
    const session = rt1.create({
      projectId: 'p1',
      harnessId: 'codex',
      controllerClientSessionId: 'client-A',
    })
    // Mark streaming without full send to keep row durable across restart
    const live = (rt1 as unknown as { live: Map<string, NodeSessionRecord> }).live.get(
      session.sessionId,
    )!
    live.status = 'streaming'
    store.save(live)

    const row = hostActions.create({
      sessionId: session.sessionId,
      controllerClientSessionId: 'client-A',
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      replayPolicy: 'safe',
    })

    // Simulate node restart: new runtime hydrates and reconciles
    const rt2 = new SessionRuntime(store, events, leases, 'env-ha', runner, {
      hostActions: createSqliteHostActionStore(db as never),
    })
    expect(rt2.get(session.sessionId)?.status).toBe('interrupted')
    expect(hostActions.get(row.actionId)?.state).toBe('cancelled')
    release()
    await rt1.dispose(100)
    await rt2.dispose(100)
  })

  it('host_action_requested event never carries args', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const runner: TurnRunner = async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'))
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        held.then(() => resolve())
      })
      return { finalText: 'done' }
    }
    const { runtime, events } = boot(runner)
    const session = createBoundSession(runtime)
    await holdTurn(runtime, session.sessionId, { released: held })

    const secret = { password: 's3cret' }
    const wait = runtime.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: secret,
      deadlineMs: 5_000,
    })
    await new Promise((r) => setTimeout(r, 20))
    const log = events.listAfter('0')
    const ha = log.filter((e) => e.eventType === 'session.host_action_requested')
    expect(ha.length).toBeGreaterThanOrEqual(1)
    for (const e of ha) {
      const payload = e.payload as Record<string, unknown>
      expect(payload.actionId).toBeTruthy()
      expect(JSON.stringify(payload)).not.toContain('s3cret')
      expect(payload).not.toHaveProperty('args')
    }
    // settle
    const snap = await runtime.pollHostActions({ controllerClientSessionId: 'client-A' })
    const a = snap.outstanding![0]!
    const claimed = runtime.claimHostAction({
      actionId: a.actionId,
      expectedVersion: a.version,
      controllerClientSessionId: 'client-A',
    })
    runtime.respondHostAction({
      actionId: claimed.actionId,
      claimToken: claimed.claimToken,
      controllerClientSessionId: 'client-A',
      outcome: 'succeeded',
      result: {},
    })
    await wait
    release()
  })
})
