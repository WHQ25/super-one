import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openNodeDatabase } from '../db/database'
import { EventLog } from './event-log'
import { ControlLeaseService } from './control-lease'
import { SessionRuntime, type TurnRunner } from './session-runtime'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('SessionRuntime.dispose', () => {
  it('awaits in-flight turn cleanup after abort (not a fixed 20ms sleep)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'srd-'))
    dirs.push(dir)
    const db = openNodeDatabase(join(dir, 'state.sqlite'))
    const envId = 'env-test'
    const events = new EventLog(db, envId)
    const leases = new ControlLeaseService(db)

    let cleanupStarted = 0
    let cleanupFinished = 0
    const slowCleanupRunner: TurnRunner = async ({ signal }) => {
      // Block until aborted, then take 80ms to "kill child".
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
      cleanupStarted = Date.now()
      await new Promise((r) => setTimeout(r, 80))
      cleanupFinished = Date.now()
      return { finalText: 'done' }
    }

    const runtime = new SessionRuntime(db, events, leases, envId, slowCleanupRunner)
    // Register a project-less session directly.
    const session = runtime.create({ projectId: 'proj-1', harnessId: 'codex' })
    const lease = leases.acquire({
      resource: { environmentId: envId, sessionId: session.sessionId },
      holderClientId: 'c1',
      ttlMs: 30_000,
    })

    // Kick off a turn (async).
    void runtime.send({
      sessionId: session.sessionId,
      text: 'hello',
      client: { clientSessionId: 'c1' },
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    // Let the turn enter the runner wait.
    await new Promise((r) => setTimeout(r, 20))

    const stopStarted = Date.now()
    await runtime.dispose(5_000)
    const stopElapsed = Date.now() - stopStarted

    expect(cleanupStarted).toBeGreaterThan(0)
    expect(cleanupFinished).toBeGreaterThan(0)
    // dispose must not resolve before the 80ms cleanup finishes.
    expect(cleanupFinished).toBeGreaterThanOrEqual(cleanupStarted + 70)
    expect(stopElapsed).toBeGreaterThanOrEqual(70)

    db.close()
  })

  it('rejects new send() after dispose starts and does not register a second in-flight turn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'srd2-'))
    dirs.push(dir)
    const db = openNodeDatabase(join(dir, 'state.sqlite'))
    const envId = 'env-test-2'
    const events = new EventLog(db, envId)
    const leases = new ControlLeaseService(db)

    let releaseA: (() => void) | undefined
    const holdA = new Promise<void>((r) => {
      releaseA = r
    })

    const runner: TurnRunner = async ({ signal }) => {
      await Promise.race([
        holdA,
        new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        }),
      ])
      // Delayed cleanup after abort.
      await new Promise((r) => setTimeout(r, 100))
      return { finalText: 'a' }
    }

    const runtime = new SessionRuntime(db, events, leases, envId, runner)
    const s1 = runtime.create({ projectId: 'p1', harnessId: 'codex' })
    const s2 = runtime.create({ projectId: 'p1', harnessId: 'codex' })
    const lease1 = leases.acquire({
      resource: { environmentId: envId, sessionId: s1.sessionId },
      holderClientId: 'c1',
      ttlMs: 30_000,
    })
    const lease2 = leases.acquire({
      resource: { environmentId: envId, sessionId: s2.sessionId },
      holderClientId: 'c1',
      ttlMs: 30_000,
    })

    void runtime.send({
      sessionId: s1.sessionId,
      text: 'first',
      client: { clientSessionId: 'c1' },
      leaseId: lease1.leaseId,
      generation: lease1.generation,
    })
    await new Promise((r) => setTimeout(r, 15))

    const disposeP = runtime.dispose(5_000)
    // Attempt a second send while dispose is draining the first turn.
    await new Promise((r) => setTimeout(r, 10))
    await expect(
      runtime.send({
        sessionId: s2.sessionId,
        text: 'second',
        client: { clientSessionId: 'c1' },
        leaseId: lease2.leaseId,
        generation: lease2.generation,
      }),
    ).rejects.toMatchObject({ code: 'failed_precondition' })

    await disposeP
    expect(runtime.isDisposing()).toBe(true)
    // Second turn must not still be streaming / in-flight.
    expect(runtime.get(s2.sessionId)?.status).not.toBe('streaming')

    releaseA?.()
    db.close()
  })
})
