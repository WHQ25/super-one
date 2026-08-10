/**
 * Host Action channel — RPC integration (claim races, controller filter, reconnect).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HOST_ACTION_TOOL_GROUPS } from '@superone/shared/environment'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'
import { createSimulatedTurnRunner, type TurnRunner } from './session-runtime'
import WebSocket from 'ws'
import { generateEd25519KeyPair, signPayload } from '../crypto-util'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop().catch(() => {})
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function boot(runner?: TurnRunner) {
  const nodeHome = mkdtempSync(join(tmpdir(), 'ha-node-'))
  dirs.push(nodeHome)
  const port = 29000 + Math.floor(Math.random() * 5000)
  const rt = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    bindPort: port,
    turnRunner: runner ?? createSimulatedTurnRunner({ delayMs: 5, chunks: ['ok'] }),
    simulatedHarness: true,
  })
  runtimes.push(rt)
  return rt
}

async function openProject(client: Awaited<ReturnType<typeof connectAuthedRpc>>) {
  const projectDir = mkdtempSync(join(tmpdir(), 'ha-proj-'))
  dirs.push(projectDir)
  writeFileSync(join(projectDir, 'f.txt'), 'x')
  return (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
}

/** Second WS for the same clientSessionId (duplicate poll / concurrent claim). */
async function openSecondSocket(
  rt: NodeRuntime,
  first: Awaited<ReturnType<typeof connectAuthedRpc>>,
) {
  const device = first.device
  const proofPayload = `refresh:${first.clientSessionId}:${Date.now()}`
  const tokenRes = await fetch(`${rt.server.url}/v1/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      refreshToken: first.refreshToken,
      proofPayload,
      proofSignature: signPayload(device.privateKeyPem, proofPayload),
    }),
  })
  const tokens = (await tokenRes.json()) as { accessToken: string; refreshToken: string }
  const ticketRes = await fetch(`${rt.server.url}/v1/ws-ticket`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokens.accessToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
  })
  const { ticket } = (await ticketRes.json()) as { ticket: string }
  const ticketId = ticket.split('.')[0] || ticket
  const sig = signPayload(device.privateKeyPem, ticketId)
  const ws = new WebSocket(`${rt.server.url.replace(/^http/, 'ws')}/ws`, {
    headers: {
      'x-superone-ws-ticket': ticket,
      'x-superone-ws-proof': ticketId,
      'x-superone-ws-sig': sig,
    },
  })
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  // handshake
  await new Promise<void>((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const timer = setTimeout(() => reject(new Error('handshake timeout')), 5_000)
    const onMsg = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as { requestId: string; type: string }
      if (msg.requestId !== requestId) return
      clearTimeout(timer)
      ws.off('message', onMsg)
      if (msg.type === 'rpc_error') reject(new Error('handshake failed'))
      else resolve()
    }
    ws.on('message', onMsg)
    ws.send(
      JSON.stringify({
        type: 'handshake',
        requestId,
        payload: {
          protocol: { current: 1, min: 1, max: 1 },
          databaseSchema: { current: 1, min: 1, max: 1 },
        },
      }),
    )
  })

  const rpc = (method: string, payload: unknown = {}) =>
    new Promise<unknown>((resolve, reject) => {
      const requestId = crypto.randomUUID()
      const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 15_000)
      const onMsg = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString()) as {
          requestId: string
          type: string
          result?: unknown
          error?: { code: string; message: string }
        }
        if (msg.requestId !== requestId) return
        clearTimeout(timer)
        ws.off('message', onMsg)
        if (msg.type === 'rpc_error') {
          reject(Object.assign(new Error(msg.error?.message || 'err'), { code: msg.error?.code }))
        } else resolve(msg.result)
      }
      ws.on('message', onMsg)
      const mutating =
        method.includes('claim') || method.includes('respond') || method.includes('send')
      ws.send(
        JSON.stringify({
          type: 'rpc',
          requestId,
          method,
          payload,
          environmentId: first.environmentId,
          protocolVersion: 1,
          idempotencyKey: mutating ? crypto.randomUUID() : undefined,
        }),
      )
    })

  return { rpc, close: () => ws.close() }
}

describe('Host Action RPC channel', () => {
  it('binds controller on session.create and advertises hostActionV1', async () => {
    const rt = await boot()
    const client = await connectAuthedRpc(rt)
    const desc = (await client.rpc('environment.descriptor')) as {
      capabilities: { hostActionV1: boolean }
    }
    expect(desc.capabilities.hostActionV1).toBe(true)

    const project = await openProject(client)
    const session = (await client.rpc('session.create', {
      projectId: project.projectId,
      harnessId: 'codex',
    })) as {
      sessionId: string
      controllerClientSessionId: string
      hostActionToolGroups: string[]
      hostActionCapabilityVersion: number
    }
    expect(session.controllerClientSessionId).toBe(client.clientSessionId)
    expect(session.hostActionCapabilityVersion).toBe(1)
    expect(session.hostActionToolGroups).toContain(HOST_ACTION_TOOL_GROUPS.browserRead)
    expect(session.hostActionToolGroups).toContain(HOST_ACTION_TOOL_GROUPS.browserAct)
    expect(session.hostActionToolGroups).toContain(HOST_ACTION_TOOL_GROUPS.superone)
    expect(session.hostActionToolGroups).toContain(HOST_ACTION_TOOL_GROUPS.computer)
    client.close()
  })

  it('atomic claim: concurrent sockets yield exactly one claim', async () => {
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
    const rt = await boot(runner)
    const client = await connectAuthedRpc(rt)
    const client2 = await openSecondSocket(rt, client)
    const project = await openProject(client)
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
      text: 'hi',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    // Create action via runtime API (harness not wired yet)
    const wait = rt.sessions.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: { n: 1 },
      deadlineMs: 30_000,
    })

    const poll = (await client.rpc('session.hostActionsPoll', {})) as {
      outstanding: Array<{ actionId: string; version: number; state: string }>
    }
    expect(poll.outstanding).toHaveLength(1)
    const action = poll.outstanding[0]!

    // Concurrent claims
    const results = await Promise.allSettled([
      client.rpc('session.claimHostAction', {
        actionId: action.actionId,
        expectedVersion: action.version,
      }),
      client2.rpc('session.claimHostAction', {
        actionId: action.actionId,
        expectedVersion: action.version,
      }),
    ])
    const ok = results.filter((r) => r.status === 'fulfilled')
    const fail = results.filter((r) => r.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(fail).toHaveLength(1)
    const claimed = (ok[0] as PromiseFulfilledResult<unknown>).value as {
      claimToken: string
      args: unknown
    }
    expect(claimed.args).toEqual({ n: 1 })

    await client.rpc('session.respondHostAction', {
      actionId: action.actionId,
      claimToken: claimed.claimToken,
      outcome: 'succeeded',
      result: { tabs: [] },
    })
    const terminal = await wait
    expect(terminal.state).toBe('succeeded')
    release()
    client.close()
    client2.close()
  })

  it('controller filtering: other client cannot poll/claim/respond', async () => {
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
    const rt = await boot(runner)
    const owner = await connectAuthedRpc(rt, 'owner')
    const other = await connectAuthedRpc(rt, 'other')
    const project = await openProject(owner)
    const session = (await owner.rpc('session.create', {
      projectId: project.projectId,
      harnessId: 'codex',
    })) as { sessionId: string }
    const lease = (await owner.rpc('session.acquireControl', {
      sessionId: session.sessionId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }
    await owner.rpc('session.send', {
      sessionId: session.sessionId,
      text: 'hi',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const wait = rt.sessions.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: { secret: 'args-only-for-owner' },
      deadlineMs: 30_000,
    })
    await new Promise((r) => setTimeout(r, 30))

    const otherPoll = (await other.rpc('session.hostActionsPoll', {})) as {
      outstanding?: unknown[]
    }
    expect(otherPoll.outstanding ?? []).toHaveLength(0)

    const ownerPoll = (await owner.rpc('session.hostActionsPoll', {})) as {
      outstanding: Array<{ actionId: string; version: number }>
    }
    const action = ownerPoll.outstanding[0]!

    await expect(
      other.rpc('session.claimHostAction', {
        actionId: action.actionId,
        expectedVersion: action.version,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })

    const claimed = (await owner.rpc('session.claimHostAction', {
      actionId: action.actionId,
      expectedVersion: action.version,
    })) as { claimToken: string; args: { secret: string } }
    expect(claimed.args.secret).toBe('args-only-for-owner')

    await expect(
      other.rpc('session.respondHostAction', {
        actionId: action.actionId,
        claimToken: claimed.claimToken,
        outcome: 'succeeded',
        result: {},
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })

    await owner.rpc('session.respondHostAction', {
      actionId: action.actionId,
      claimToken: claimed.claimToken,
      outcome: 'succeeded',
      result: { ok: 1 },
    })
    // identical respond accepted
    const dup = (await owner.rpc('session.respondHostAction', {
      actionId: action.actionId,
      claimToken: claimed.claimToken,
      outcome: 'succeeded',
      result: { ok: 1 },
    })) as { duplicate: boolean }
    expect(dup.duplicate).toBe(true)

    await expect(
      owner.rpc('session.respondHostAction', {
        actionId: action.actionId,
        claimToken: claimed.claimToken,
        outcome: 'succeeded',
        result: { ok: 2 },
      }),
    ).rejects.toMatchObject({ code: 'conflict' })

    expect((await wait).state).toBe('succeeded')
    release()
    owner.close()
    other.close()
  })

  it('poll never returns args fields', async () => {
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
    const rt = await boot(runner)
    const client = await connectAuthedRpc(rt)
    const project = await openProject(client)
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
      text: 'hi',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    const wait = rt.sessions.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: { password: 'hidden' },
      deadlineMs: 10_000,
    })
    await new Promise((r) => setTimeout(r, 30))
    const poll = await client.rpc('session.hostActionsPoll', {})
    expect(JSON.stringify(poll)).not.toContain('hidden')
    expect(JSON.stringify(poll)).not.toContain('password')
    // cancel via interrupt
    await client.rpc('session.interrupt', {
      sessionId: session.sessionId,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    await wait
    release()
    client.close()
  })

  /**
   * Re-pair / client-session rotation: old controller is gone, new client takes
   * the control lease. Without rebind on acquireControl, host actions stay
   * addressed to the revoked id and the new desktop never claims them.
   */
  it('acquireControl rebinds HA controller so a new paired client can claim', async () => {
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
    const rt = await boot(runner)
    const original = await connectAuthedRpc(rt, 'original-desktop')
    const project = await openProject(original)
    const session = (await original.rpc('session.create', {
      projectId: project.projectId,
      harnessId: 'codex',
    })) as { sessionId: string; controllerClientSessionId: string }
    expect(session.controllerClientSessionId).toBe(original.clientSessionId)

    const lease = (await original.rpc('session.acquireControl', {
      sessionId: session.sessionId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }
    await original.rpc('session.send', {
      sessionId: session.sessionId,
      text: 'hi',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    // Outstanding action minted under the original controller (pre-rotation).
    const wait = rt.sessions.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: { rotated: true },
      deadlineMs: 30_000,
    })
    await new Promise((r) => setTimeout(r, 30))

    // Simulate re-pair: release lease, new client session takes control.
    await original.rpc('session.releaseControl', {
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    original.close()

    const repaired = await connectAuthedRpc(rt, 'repaired-desktop')
    expect(repaired.clientSessionId).not.toBe(original.clientSessionId)

    await repaired.rpc('session.acquireControl', {
      sessionId: session.sessionId,
      ttlMs: 60_000,
    })

    const after = (await repaired.rpc('session.get', {
      sessionId: session.sessionId,
    })) as { controllerClientSessionId: string | null }
    expect(after.controllerClientSessionId).toBe(repaired.clientSessionId)

    const poll = (await repaired.rpc('session.hostActionsPoll', {})) as {
      outstanding: Array<{ actionId: string; version: number; state: string }>
    }
    expect(poll.outstanding).toHaveLength(1)
    const action = poll.outstanding[0]!
    expect(action.state).toBe('pending')

    const claimed = (await repaired.rpc('session.claimHostAction', {
      actionId: action.actionId,
      expectedVersion: action.version,
    })) as { claimToken: string; args: { rotated: boolean } }
    expect(claimed.args.rotated).toBe(true)

    await repaired.rpc('session.respondHostAction', {
      actionId: action.actionId,
      claimToken: claimed.claimToken,
      outcome: 'succeeded',
      result: { ok: true },
    })
    await expect(wait).resolves.toMatchObject({ state: 'succeeded' })

    // New mints also go to the repaired controller.
    const wait2 = rt.sessions.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: { afterRebind: true },
      deadlineMs: 30_000,
    })
    await new Promise((r) => setTimeout(r, 30))
    const poll2 = (await repaired.rpc('session.hostActionsPoll', {})) as {
      outstanding: Array<{ actionId: string; version: number }>
    }
    expect(poll2.outstanding).toHaveLength(1)
    const claimed2 = (await repaired.rpc('session.claimHostAction', {
      actionId: poll2.outstanding[0]!.actionId,
      expectedVersion: poll2.outstanding[0]!.version,
    })) as { claimToken: string }
    await repaired.rpc('session.respondHostAction', {
      actionId: poll2.outstanding[0]!.actionId,
      claimToken: claimed2.claimToken,
      outcome: 'succeeded',
      result: {},
    })
    await expect(wait2).resolves.toMatchObject({ state: 'succeeded' })

    release()
    repaired.close()
  })
})
