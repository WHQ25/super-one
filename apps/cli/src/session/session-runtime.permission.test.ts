/**
 * Stage 5-D: permission request → respond / timeout / abort lifecycle.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openNodeDatabase } from '../db/database'
import { ControlLeaseService } from './control-lease'
import { EventLog } from './event-log'
import {
  SessionRuntime,
  createSimulatedCodexRunner,
  type TurnRunner,
} from './session-runtime'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function boot(runner: TurnRunner, permissionTimeoutMs = 5_000) {
  const dir = mkdtempSync(join(tmpdir(), 'srp-'))
  dirs.push(dir)
  const db = openNodeDatabase(join(dir, 'state.sqlite'))
  const envId = 'env-perm'
  const events = new EventLog(db, envId)
  const leases = new ControlLeaseService(db)
  const runtime = new SessionRuntime(db, events, leases, envId, runner, {
    permissionTimeoutMs,
  })
  return { db, events, leases, runtime, envId }
}

function acquire(runtime: SessionRuntime, leases: ControlLeaseService, envId: string) {
  const session = runtime.create({ projectId: 'proj-1', harnessId: 'codex' })
  const lease = leases.acquire({
    resource: { environmentId: envId, sessionId: session.sessionId },
    holderClientId: 'client-1',
    ttlMs: 60_000,
  })
  return {
    session,
    lease,
    client: { clientSessionId: 'client-1' },
  }
}

async function waitForPending(
  runtime: SessionRuntime,
  sessionId: string,
  attempts = 50,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const s = runtime.get(sessionId)
    if (s?.pendingInteraction?.interactionId) return s.pendingInteraction.interactionId
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('pending interaction not observed')
}

async function waitIdle(runtime: SessionRuntime, sessionId: string, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    const s = runtime.get(sessionId)
    if (s && s.status !== 'streaming') return s
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('session never left streaming')
}

describe('SessionRuntime permission respond lifecycle', () => {
  it('allow continues the turn and emits requested → responded → completed', async () => {
    const { runtime, events, leases, envId, db } = boot(
      createSimulatedCodexRunner({
        delayMs: 5,
        chunks: ['ok'],
        requestPermission: true,
      }),
    )
    const { session, lease, client } = acquire(runtime, leases, envId)

    runtime.send({
      sessionId: session.sessionId,
      text: 'need tool',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const interactionId = await waitForPending(runtime, session.sessionId)
    runtime.respondPermission({
      sessionId: session.sessionId,
      interactionId,
      decision: 'allow',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const final = await waitIdle(runtime, session.sessionId)
    expect(final.status).toBe('idle')
    expect(final.pendingInteraction).toBeNull()
    expect(final.transcript.some((b) => b.role === 'assistant' && b.text.includes('ok'))).toBe(
      true,
    )

    const types = events
      .listAfter('0')
      .filter((e) => e.aggregateId === session.sessionId)
      .map((e) => e.eventType)
    expect(types).toContain('session.permission_requested')
    expect(types).toContain('session.permission_responded')
    expect(types).toContain('session.turn_completed')
    expect(types.indexOf('session.permission_requested')).toBeLessThan(
      types.indexOf('session.permission_responded'),
    )
    expect(types.indexOf('session.permission_responded')).toBeLessThan(
      types.indexOf('session.turn_completed'),
    )

    db.close()
  })

  it('deny stops the simulated turn with Permission denied', async () => {
    const { runtime, events, leases, envId, db } = boot(
      createSimulatedCodexRunner({
        delayMs: 5,
        chunks: ['should-not-stream'],
        requestPermission: true,
      }),
    )
    const { session, lease, client } = acquire(runtime, leases, envId)

    runtime.send({
      sessionId: session.sessionId,
      text: 'need tool',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const interactionId = await waitForPending(runtime, session.sessionId)
    runtime.respondPermission({
      sessionId: session.sessionId,
      interactionId,
      decision: 'deny',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const final = await waitIdle(runtime, session.sessionId)
    expect(final.status).toBe('idle')
    expect(final.transcript.at(-1)?.text).toBe('Permission denied.')

    const responded = events
      .listAfter('0')
      .find((e) => e.eventType === 'session.permission_responded')
    expect(responded?.payload).toMatchObject({ interactionId, decision: 'deny' })

    db.close()
  })

  it('allow_always resolves as allow for the runner and preserves wire decision', async () => {
    const { runtime, events, leases, envId, db } = boot(
      createSimulatedCodexRunner({ delayMs: 5, chunks: ['ok'], requestPermission: true }),
    )
    const { session, lease, client } = acquire(runtime, leases, envId)

    runtime.send({
      sessionId: session.sessionId,
      text: 'need tool',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    const interactionId = await waitForPending(runtime, session.sessionId)
    runtime.respondPermission({
      sessionId: session.sessionId,
      interactionId,
      decision: 'allow_always',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    const final = await waitIdle(runtime, session.sessionId)
    expect(final.status).toBe('idle')
    const responded = events
      .listAfter('0')
      .find((e) => e.eventType === 'session.permission_responded')
    expect(responded?.payload).toMatchObject({ decision: 'allow_always' })
    db.close()
  })

  it('rejects respond with wrong interactionId or after already answered', async () => {
    const { runtime, leases, envId, db } = boot(
      createSimulatedCodexRunner({ delayMs: 5, chunks: ['ok'], requestPermission: true }),
    )
    const { session, lease, client } = acquire(runtime, leases, envId)

    runtime.send({
      sessionId: session.sessionId,
      text: 'need tool',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    const interactionId = await waitForPending(runtime, session.sessionId)

    expect(() =>
      runtime.respondPermission({
        sessionId: session.sessionId,
        interactionId: 'not-the-id',
        decision: 'allow',
        client,
        leaseId: lease.leaseId,
        generation: lease.generation,
      }),
    ).toThrow(/no matching pending permission/)

    runtime.respondPermission({
      sessionId: session.sessionId,
      interactionId,
      decision: 'allow',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    await waitIdle(runtime, session.sessionId)

    expect(() =>
      runtime.respondPermission({
        sessionId: session.sessionId,
        interactionId,
        decision: 'allow',
        client,
        leaseId: lease.leaseId,
        generation: lease.generation,
      }),
    ).toThrow(/no matching pending permission/)

    db.close()
  })

  it('times out pending permission as deny', async () => {
    const { runtime, events, leases, envId, db } = boot(
      createSimulatedCodexRunner({ delayMs: 5, chunks: ['later'], requestPermission: true }),
      40,
    )
    const { session, lease, client } = acquire(runtime, leases, envId)

    runtime.send({
      sessionId: session.sessionId,
      text: 'need tool',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    await waitForPending(runtime, session.sessionId)
    const final = await waitIdle(runtime, session.sessionId)
    expect(final.status).toBe('idle')
    expect(final.transcript.at(-1)?.text).toBe('Permission denied.')
    expect(
      events.listAfter('0').some((e) => e.eventType === 'session.permission_timeout'),
    ).toBe(true)
    expect(final.pendingInteraction).toBeNull()
    db.close()
  })

  it('interrupt while waiting denies via permission_aborted', async () => {
    const { runtime, events, leases, envId, db } = boot(
      createSimulatedCodexRunner({ delayMs: 5, chunks: ['x'], requestPermission: true }),
      30_000,
    )
    const { session, lease, client } = acquire(runtime, leases, envId)

    runtime.send({
      sessionId: session.sessionId,
      text: 'need tool',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    await waitForPending(runtime, session.sessionId)

    runtime.interrupt(session.sessionId, client, lease.leaseId, lease.generation)
    const final = await waitIdle(runtime, session.sessionId)
    expect(['interrupted', 'idle', 'error']).toContain(final.status)
    expect(
      events.listAfter('0').some((e) => e.eventType === 'session.permission_aborted'),
    ).toBe(true)
    expect(final.pendingInteraction).toBeNull()
    db.close()
  })
})
