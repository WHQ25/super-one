import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { createSimulatedCodexRunner } from './session-runtime'
import { connectAuthedRpc } from '../test/ws-rpc'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop().catch(() => {})
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function boot(turnRunner = createSimulatedCodexRunner({ delayMs: 40, chunks: ['A', 'B', 'C', 'D'] })) {
  const nodeHome = mkdtempSync(join(tmpdir(), 'p3-node-'))
  dirs.push(nodeHome)
  const port = 27000 + Math.floor(Math.random() * 10000)
  const rt = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    bindPort: port,
    turnRunner, simulatedHarness: true })
  runtimes.push(rt)
  return rt
}

describe('Phase 3 disconnect-safe remote Session', () => {
  it('continues turn after client disconnect and reconnect hydrates ordered events', async () => {
    const rt = await boot(
      createSimulatedCodexRunner({
        delayMs: 50,
        chunks: ['one ', 'two ', 'three ', 'four'],
      }),
    )
    const projectDir = mkdtempSync(join(tmpdir(), 'p3-proj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'f.txt'), 'x')

    const client = await connectAuthedRpc(rt)
    const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
    const session = (await client.rpc('session.create', {
      projectId: project.projectId,
      harnessId: 'codex',
      title: 't1',
    })) as { sessionId: string; status: string }

    const lease = (await client.rpc('session.acquireControl', {
      sessionId: session.sessionId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }

    await client.rpc('session.send', {
      sessionId: session.sessionId,
      text: 'hi',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const mid = (await client.rpc('session.events', { afterSequence: '0' })) as {
      events: Array<{ sequence: string; eventType: string }>
    }
    expect(mid.events.some((e) => e.eventType === 'session.turn_started')).toBe(true)
    const cursor = mid.events[mid.events.length - 1]!.sequence
    client.close()

    await new Promise((r) => setTimeout(r, 400))

    const client2 = await connectAuthedRpc(rt, 'c1-reconnect')
    const snap = (await client2.rpc('session.snapshot')) as {
      snapshotSequence: string
      sessions: Array<{ sessionId: string; status: string; transcript: Array<{ text: string }> }>
    }
    const recovered = snap.sessions.find((s) => s.sessionId === session.sessionId)
    expect(recovered).toBeTruthy()
    expect(recovered!.status).toBe('idle')
    expect(recovered!.transcript.some((t) => t.text.includes('one'))).toBe(true)

    const after = (await client2.rpc('session.events', { afterSequence: cursor })) as {
      events: Array<{ eventType: string; sequence: string }>
    }
    const types = after.events.map((e) => e.eventType)
    expect(types).toContain('session.turn_completed')
    for (let i = 1; i < after.events.length; i++) {
      expect(Number(after.events[i]!.sequence)).toBeGreaterThan(Number(after.events[i - 1]!.sequence))
    }
    client2.close()
  })

  it('reconciles streaming sessions as interrupted after node restart (non-reattachable)', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'p3-restart-'))
    dirs.push(nodeHome)
    const port = 28000 + Math.floor(Math.random() * 5000)

    let resolveHold: (() => void) | undefined
    const hold = new Promise<void>((r) => {
      resolveHold = r
    })
    const runner = createSimulatedCodexRunner({ delayMs: 10, chunks: ['x'] })
    const blockingRunner: typeof runner = async (input) => {
      // Stay blocked until hold is released OR the runtime aborts on stop/dispose.
      await Promise.race([
        hold,
        new Promise<void>((resolve) => {
          if (input.signal.aborted) resolve()
          else input.signal.addEventListener('abort', () => resolve(), { once: true })
        }),
      ])
      if (input.signal.aborted) {
        throw new Error('aborted')
      }
      return runner(input)
    }

    const rt = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      bindPort: port,
      turnRunner: blockingRunner, simulatedHarness: true })
    runtimes.push(rt)

    const projectDir = mkdtempSync(join(tmpdir(), 'p3-proj2-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'a'), '1')

    const client = await connectAuthedRpc(rt)
    const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
    const session = (await client.rpc('session.create', { projectId: project.projectId })) as {
      sessionId: string
    }
    const lease = (await client.rpc('session.acquireControl', {
      sessionId: session.sessionId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }
    await client.rpc('session.send', {
      sessionId: session.sessionId,
      text: 'go',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    await new Promise((r) => setTimeout(r, 30))
    const mid = rt.sessions.get(session.sessionId)
    expect(mid?.status).toBe('streaming')

    client.close()
    // Simulate a hard crash while a turn is still streaming: leave the durable
    // row as streaming and close the process without graceful dispose settling
    // the turn (which would now await abort cleanup and mark interrupted).
    rt.db
      .prepare(`UPDATE sessions SET status = 'streaming', updated_at = ? WHERE session_id = ?`)
      .run(Date.now(), session.sessionId)
    // Force-close DB handles; do not await sessions.dispose() for this scenario.
    try {
      await rt.server.close()
    } catch {
      /* ignore */
    }
    try {
      rt.db.close()
    } catch {
      /* ignore */
    }
    runtimes.pop()
    if (resolveHold) resolveHold()

    const rt2 = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      bindPort: port + 1,
      turnRunner: createSimulatedCodexRunner(), simulatedHarness: true })
    runtimes.push(rt2)

    const reconciled = rt2.sessions.get(session.sessionId)
    expect(reconciled).toBeTruthy()
    expect(reconciled!.status).toBe('interrupted')
    expect(reconciled!.status).not.toBe('streaming')

    const events = rt2.sessions.listEventsAfter('0')
    expect(events.some((e) => e.eventType === 'session.reconciled')).toBe(true)
  })

  it('denies permission responses from a client without the control lease', async () => {
    const rt = await boot(
      createSimulatedCodexRunner({ delayMs: 20, chunks: ['ok'], requestPermission: true }),
    )
    const projectDir = mkdtempSync(join(tmpdir(), 'p3-perm-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'a'), '1')

    const holder = await connectAuthedRpc(rt, 'holder')
    const other = await connectAuthedRpc(rt, 'other')

    const project = (await holder.rpc('project.open', { path: projectDir })) as { projectId: string }
    const session = (await holder.rpc('session.create', { projectId: project.projectId })) as {
      sessionId: string
    }
    const lease = (await holder.rpc('session.acquireControl', {
      sessionId: session.sessionId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }

    await holder.rpc('session.send', {
      sessionId: session.sessionId,
      text: 'need perm',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    let interactionId = ''
    for (let i = 0; i < 50; i++) {
      const s = (await holder.rpc('session.get', { sessionId: session.sessionId })) as {
        pendingInteraction: { interactionId: string } | null
      }
      if (s.pendingInteraction) {
        interactionId = s.pendingInteraction.interactionId
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(interactionId).toBeTruthy()

    await expect(
      other.rpc('session.respondPermission', {
        sessionId: session.sessionId,
        interactionId,
        decision: 'allow',
        leaseId: 'fake',
        generation: '1',
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/lease|forbidden|stale|required/) })

    await expect(
      other.rpc('session.acquireControl', { sessionId: session.sessionId, ttlMs: 1000 }),
    ).rejects.toBeTruthy()

    await holder.rpc('session.respondPermission', {
      sessionId: session.sessionId,
      interactionId,
      decision: 'allow',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    holder.close()
    other.close()
  })

  it('permission allow lifecycle completes the turn over RPC', async () => {
    const rt = await boot(
      createSimulatedCodexRunner({ delayMs: 10, chunks: ['after-allow'], requestPermission: true }),
    )
    const projectDir = mkdtempSync(join(tmpdir(), 'p3-perm-allow-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'a'), '1')

    const client = await connectAuthedRpc(rt, 'holder')
    const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
    const session = (await client.rpc('session.create', { projectId: project.projectId })) as {
      sessionId: string
    }
    const lease = (await client.rpc('session.acquireControl', {
      sessionId: session.sessionId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }

    await client.rpc('session.send', {
      sessionId: session.sessionId,
      text: 'need perm',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    let interactionId = ''
    for (let i = 0; i < 50; i++) {
      const s = (await client.rpc('session.get', { sessionId: session.sessionId })) as {
        pendingInteraction: { interactionId: string; toolName?: string } | null
        status: string
      }
      if (s.pendingInteraction) {
        interactionId = s.pendingInteraction.interactionId
        expect(s.status).toBe('streaming')
        expect(s.pendingInteraction.toolName).toBe('shell')
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(interactionId).toBeTruthy()

    await client.rpc('session.respondPermission', {
      sessionId: session.sessionId,
      interactionId,
      decision: 'allow',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    let finalStatus = 'streaming'
    let transcript: Array<{ role?: string; text?: string }> = []
    for (let i = 0; i < 80; i++) {
      const s = (await client.rpc('session.get', { sessionId: session.sessionId })) as {
        status: string
        pendingInteraction: unknown
        transcript: Array<{ role?: string; text?: string }>
      }
      finalStatus = s.status
      transcript = s.transcript
      if (s.status === 'idle' && !s.pendingInteraction) break
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(finalStatus).toBe('idle')
    expect(transcript.some((b) => b.text?.includes('after-allow'))).toBe(true)

    const events = (
      (await client.rpc('session.events', { afterSequence: '0' })) as {
        events: Array<{ eventType: string; payload: { decision?: string } }>
      }
    ).events
    const types = events.map((e) => e.eventType)
    expect(types).toContain('session.permission_requested')
    expect(types).toContain('session.permission_responded')
    expect(types).toContain('session.turn_completed')

    client.close()
  })
})
