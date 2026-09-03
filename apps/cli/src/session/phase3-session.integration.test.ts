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
  const rt = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    // Ephemeral port: the OS picks a free one and the handle's `url` carries
    // it back, so parallel test files cannot collide.
    bindPort: 0,
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
      // Ephemeral port: the OS picks a free one and the handle's `url` carries
      // it back, so parallel test files cannot collide.
      bindPort: 0,
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
      // Ephemeral port: the OS picks a free one and the handle's `url`
      // carries it back. The previous runtime is stopped above, so the
      // restart does not need a different number to dodge TIME_WAIT.
      bindPort: 0,
      turnRunner: createSimulatedCodexRunner(), simulatedHarness: true })
    runtimes.push(rt2)

    const reconciled = rt2.sessions.get(session.sessionId)
    expect(reconciled).toBeTruthy()
    expect(reconciled!.status).toBe('interrupted')
    expect(reconciled!.status).not.toBe('streaming')

    const events = rt2.sessions.listEventsAfter('0')
    expect(events.some((e) => e.eventType === 'session.reconciled')).toBe(true)
  })

  it('session.patchSettings persists and next send without model uses stored model', async () => {
    let seenModel: string | null | undefined
    const runner = createSimulatedCodexRunner({ delayMs: 5, chunks: ['ok'] })
    const capturing: typeof runner = async (input) => {
      seenModel = input.model ?? null
      return runner(input)
    }
    const rt = await boot(capturing)
    const projectDir = mkdtempSync(join(tmpdir(), 'p3-settings-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'a'), '1')

    const client = await connectAuthedRpc(rt)
    const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
    const session = (await client.rpc('session.create', {
      projectId: project.projectId,
      harnessId: 'codex',
    })) as { sessionId: string }

    const lease = (await client.rpc('session.acquireControl', {
      sessionId: session.sessionId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }

    const patched = (await client.rpc('session.patchSettings', {
      sessionId: session.sessionId,
      leaseId: lease.leaseId,
      generation: lease.generation,
      settings: { model: 'gpt-stored-model', effort: 'high' },
    })) as { model: string | null; effort: string | null }
    expect(patched.model).toBe('gpt-stored-model')
    expect(patched.effort).toBe('high')

    const got = (await client.rpc('session.get', { sessionId: session.sessionId })) as {
      model: string | null
    }
    expect(got.model).toBe('gpt-stored-model')

    await client.rpc('session.send', {
      sessionId: session.sessionId,
      text: 'use stored model',
      leaseId: lease.leaseId,
      generation: lease.generation,
      // no options.model
    })

    for (let i = 0; i < 50; i++) {
      const s = (await client.rpc('session.get', { sessionId: session.sessionId })) as {
        status: string
      }
      if (s.status === 'idle') break
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(seenModel).toBe('gpt-stored-model')
    client.close()
  })

  it('after node restart session.get returns providerResume and coldSessionResume is true', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'p3-cold-'))
    dirs.push(nodeHome)

    const rt = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      // Ephemeral port: the OS picks a free one and the handle's `url` carries
      // it back, so parallel test files cannot collide.
      bindPort: 0,
      turnRunner: createSimulatedCodexRunner({ delayMs: 10, chunks: ['hi'] }),
      simulatedHarness: true,
    })
    runtimes.push(rt)

    const client = await connectAuthedRpc(rt, 'cold-1')
    const desc = (await client.rpc('environment.descriptor', {})) as {
      capabilities: { coldSessionResume: boolean; turnReattach: boolean }
    }
    expect(desc.capabilities.coldSessionResume).toBe(true)
    expect(desc.capabilities.turnReattach).toBe(false)

    const projectDir = mkdtempSync(join(tmpdir(), 'p3-cold-proj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'a'), '1')
    const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
    const session = (await client.rpc('session.create', {
      projectId: project.projectId,
      harnessId: 'codex',
    })) as { sessionId: string }
    const lease = (await client.rpc('session.acquireControl', {
      sessionId: session.sessionId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }
    await client.rpc('session.send', {
      sessionId: session.sessionId,
      text: 'first turn',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    for (let i = 0; i < 50; i++) {
      const s = (await client.rpc('session.get', { sessionId: session.sessionId })) as {
        status: string
        providerResume: string | null
      }
      if (s.status === 'idle' && s.providerResume) break
      await new Promise((r) => setTimeout(r, 20))
    }
    const before = (await client.rpc('session.get', { sessionId: session.sessionId })) as {
      providerResume: string | null
      status: string
    }
    expect(before.providerResume).toBeTruthy()
    expect(before.providerResume).toMatch(/^resume-/)
    client.close()
    await rt.stop()
    runtimes.pop()

    const rt2 = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      // Ephemeral port: the OS picks a free one and the handle's `url`
      // carries it back. The previous runtime is stopped above, so the
      // restart does not need a different number to dodge TIME_WAIT.
      bindPort: 0,
      turnRunner: createSimulatedCodexRunner({ delayMs: 5, chunks: ['again'] }),
      simulatedHarness: true,
    })
    runtimes.push(rt2)

    const client2 = await connectAuthedRpc(rt2, 'cold-2')
    const desc2 = (await client2.rpc('environment.descriptor', {})) as {
      capabilities: { coldSessionResume: boolean }
    }
    expect(desc2.capabilities.coldSessionResume).toBe(true)

    const after = (await client2.rpc('session.get', { sessionId: session.sessionId })) as {
      providerResume: string | null
      status: string
    }
    expect(after.providerResume).toBe(before.providerResume)
    expect(after.status).not.toBe('streaming')

    // Second turn continues with restored provider identity.
    const lease2 = (await client2.rpc('session.acquireControl', {
      sessionId: session.sessionId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }
    await client2.rpc('session.send', {
      sessionId: session.sessionId,
      text: 'second turn after restart',
      leaseId: lease2.leaseId,
      generation: lease2.generation,
    })
    for (let i = 0; i < 50; i++) {
      const s = (await client2.rpc('session.get', { sessionId: session.sessionId })) as {
        status: string
      }
      if (s.status === 'idle') break
      await new Promise((r) => setTimeout(r, 20))
    }
    const final = (await client2.rpc('session.get', { sessionId: session.sessionId })) as {
      providerResume: string | null
      status: string
    }
    expect(final.status).toBe('idle')
    expect(final.providerResume).toBeTruthy()
    client2.close()
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

  it('session.messages.list returns paged denser blocks with cursor', async () => {
    const rt = await boot(
      createSimulatedCodexRunner({
        delayMs: 5,
        chunks: ['tool ', 'path'],
        emitStructuredEvents: true,
      }),
    )
    const projectDir = mkdtempSync(join(tmpdir(), 'p3-msgs-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'f.txt'), 'x')

    const client = await connectAuthedRpc(rt)
    const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
    const session = (await client.rpc('session.create', {
      projectId: project.projectId,
      harnessId: 'codex',
      title: 'msgs',
    })) as { sessionId: string }
    const lease = (await client.rpc('session.acquireControl', {
      sessionId: session.sessionId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }

    // Two turns so catalog has 4 transcript blocks for cursor paging.
    for (const text of ['first', 'second']) {
      await client.rpc('session.send', {
        sessionId: session.sessionId,
        text,
        leaseId: lease.leaseId,
        generation: lease.generation,
      })
      for (let i = 0; i < 80; i++) {
        const s = (await client.rpc('session.get', { sessionId: session.sessionId })) as {
          status: string
        }
        if (s.status === 'idle') break
        await new Promise((r) => setTimeout(r, 15))
      }
    }

    const full = (await client.rpc('session.messages.list', {
      sessionId: session.sessionId,
      limit: 100,
    })) as {
      sessionId: string
      messages: Array<{
        id: string
        role: string
        text: string
        sortOrder: number
        tools?: Array<{ toolName: string; toolUseId: string }>
        resumePointId?: string
      }>
      cursor: string | null
      hasMore: boolean
    }
    expect(full.sessionId).toBe(session.sessionId)
    expect(full.messages.length).toBeGreaterThanOrEqual(4)
    expect(full.hasMore).toBe(false)
    expect(full.cursor).toBeNull()
    const assistants = full.messages.filter((m) => m.role === 'assistant')
    expect(assistants.length).toBeGreaterThanOrEqual(2)
    // Structured tool events densify at least one assistant block.
    expect(assistants.some((m) => (m.tools?.length ?? 0) > 0)).toBe(true)
    expect(assistants.some((m) => m.tools?.some((t) => t.toolName === 'Read'))).toBe(true)
    // Provider resume stamped on the last assistant when present.
    expect(assistants.at(-1)?.resumePointId).toBeTruthy()

    const pageNewest = (await client.rpc('session.messages.list', {
      sessionId: session.sessionId,
      limit: 2,
    })) as {
      messages: Array<{ id: string; sortOrder: number }>
      cursor: string | null
      hasMore: boolean
    }
    expect(pageNewest.messages).toHaveLength(2)
    expect(pageNewest.hasMore).toBe(true)
    expect(pageNewest.cursor).toBeTruthy()
    expect(pageNewest.messages[0]!.sortOrder).toBeLessThan(pageNewest.messages[1]!.sortOrder)

    const pageOlder = (await client.rpc('session.messages.list', {
      sessionId: session.sessionId,
      limit: 2,
      cursor: pageNewest.cursor,
    })) as {
      messages: Array<{ id: string; sortOrder: number }>
      cursor: string | null
      hasMore: boolean
    }
    expect(pageOlder.messages).toHaveLength(2)
    expect(pageOlder.messages.every((m) => m.sortOrder < pageNewest.messages[0]!.sortOrder)).toBe(
      true,
    )
    // Combined pages cover the full catalog without id overlap.
    const ids = [...pageOlder.messages, ...pageNewest.messages].map((m) => m.id)
    expect(new Set(ids).size).toBe(4)

    // Live resume path still uses session.events afterSequence.
    const events = (await client.rpc('session.events', { afterSequence: '0' })) as {
      events: Array<{ eventType: string }>
    }
    expect(events.events.some((e) => e.eventType === 'session.turn_completed')).toBe(true)

    client.close()
  })
})
