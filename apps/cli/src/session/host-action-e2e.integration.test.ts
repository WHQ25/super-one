/**
 * Slice 1 E2E: MCP browser_snapshot → Host Action channel → claim/respond lifecycle.
 * Claude harness path is exercised via injected requestHostAction (same as MCP tool).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { HOST_ACTION_TOOL_GROUPS } from '@superone/shared/environment'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'
import { createSimulatedTurnRunner, type TurnRunner } from './session-runtime'

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
  const nodeHome = mkdtempSync(join(tmpdir(), 'ha-e2e-'))
  dirs.push(nodeHome)
  const port = 30000 + Math.floor(Math.random() * 4000)
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

async function setupStreamingSession(rt: NodeRuntime, hold: Promise<void>) {
  const runner: TurnRunner = async ({ signal }) => {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error('aborted'))
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      hold.then(() => resolve())
    })
    return { finalText: 'done' }
  }
  // Re-boot with hold runner
  await rt.stop()
  runtimes.pop()
  const nodeHome = mkdtempSync(join(tmpdir(), 'ha-e2e2-'))
  dirs.push(nodeHome)
  const port = 31000 + Math.floor(Math.random() * 4000)
  const rt2 = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    bindPort: port,
    turnRunner: runner,
    simulatedHarness: true,
  })
  runtimes.push(rt2)

  const client = await connectAuthedRpc(rt2)
  const projectDir = mkdtempSync(join(tmpdir(), 'ha-proj-'))
  dirs.push(projectDir)
  writeFileSync(join(projectDir, 'f.txt'), 'x')
  const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
  const session = (await client.rpc('session.create', {
    projectId: project.projectId,
    harnessId: 'codex',
  })) as { sessionId: string; controllerClientSessionId: string }
  const lease = (await client.rpc('session.acquireControl', {
    sessionId: session.sessionId,
    ttlMs: 120_000,
  })) as { leaseId: string; generation: string }
  await client.rpc('session.send', {
    sessionId: session.sessionId,
    text: 'turn',
    leaseId: lease.leaseId,
    generation: lease.generation,
  })
  return { rt: rt2, client, session, lease }
}

describe('Host Action E2E via MCP + RPC', () => {
  it('two parallel browser_snapshot host actions both complete', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const { rt, client, session } = await setupStreamingSession(
      await boot(),
      held,
    )

    expect(rt.hostActionMcp).toBeTruthy()
    const mcp = rt.hostActionMcp!
    const cfg = mcp.getHttpConfig(session.sessionId)
    const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: { headers: cfg.headers },
    })
    const mcpClient = new Client({ name: 'e2e', version: '1.0.0' })
    await mcpClient.connect(transport)

    // Fire two tool calls in parallel — both create host actions and wait.
    // Use schema field `filter` as a correlator (unknown keys are stripped by Zod).
    const p1 = mcpClient.callTool({ name: 'browser_snapshot', arguments: { filter: 'one' } })
    const p2 = mcpClient.callTool({ name: 'browser_snapshot', arguments: { filter: 'two' } })
    await new Promise((r) => setTimeout(r, 50))

    const poll = (await client.rpc('session.hostActionsPoll', {})) as {
      outstanding: Array<{ actionId: string; version: number; state: string }>
    }
    expect(poll.outstanding.length).toBe(2)

    // Claim and respond both (controller path)
    await Promise.all(
      poll.outstanding.map(async (a) => {
        const claimed = (await client.rpc('session.claimHostAction', {
          actionId: a.actionId,
          expectedVersion: a.version,
        })) as { claimToken: string; toolName: string; args: { filter?: string } }
        expect(claimed.toolName).toBe('browser_snapshot')
        expect(claimed.args.filter === 'one' || claimed.args.filter === 'two').toBe(true)
        await client.rpc('session.respondHostAction', {
          actionId: a.actionId,
          claimToken: claimed.claimToken,
          outcome: 'succeeded',
          result: {
            content: [{ type: 'text', text: `snap-${claimed.args.filter}` }],
          },
        })
      }),
    )

    const [r1, r2] = (await Promise.all([p1, p2])) as Array<{
      content: Array<{ text: string }>
    }>
    const texts = [r1!.content[0]!.text, r2!.content[0]!.text].sort()
    expect(texts).toEqual(['snap-one', 'snap-two'])

    release()
    await mcpClient.close()
    client.close()
  })

  it('controller mismatch fails closed on claim', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const { rt, client, session } = await setupStreamingSession(await boot(), held)
    const other = await connectAuthedRpc(rt, 'other-desk')

    const wait = rt.sessions.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser_snapshot',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      replayPolicy: 'safe',
      deadlineMs: 15_000,
    })
    await new Promise((r) => setTimeout(r, 30))
    const poll = (await client.rpc('session.hostActionsPoll', {})) as {
      outstanding: Array<{ actionId: string; version: number }>
    }
    const action = poll.outstanding[0]!

    await expect(
      other.rpc('session.claimHostAction', {
        actionId: action.actionId,
        expectedVersion: action.version,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })

    const claimed = (await client.rpc('session.claimHostAction', {
      actionId: action.actionId,
      expectedVersion: action.version,
    })) as { claimToken: string }
    await client.rpc('session.respondHostAction', {
      actionId: action.actionId,
      claimToken: claimed.claimToken,
      outcome: 'succeeded',
      result: { content: [{ type: 'text', text: 'ok' }] },
    })
    expect((await wait).state).toBe('succeeded')
    release()
    client.close()
    other.close()
  })

  it('interrupt during claimed execution cancels and rejects late respond', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const { rt, client, session, lease } = await setupStreamingSession(await boot(), held)

    const wait = rt.sessions.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser_snapshot',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      replayPolicy: 'safe',
      deadlineMs: 30_000,
    })
    await new Promise((r) => setTimeout(r, 30))
    const poll = (await client.rpc('session.hostActionsPoll', {})) as {
      outstanding: Array<{ actionId: string; version: number }>
    }
    const action = poll.outstanding[0]!
    const claimed = (await client.rpc('session.claimHostAction', {
      actionId: action.actionId,
      expectedVersion: action.version,
    })) as { claimToken: string }

    await client.rpc('session.interrupt', {
      sessionId: session.sessionId,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    expect((await wait).state).toBe('cancelled')

    await expect(
      client.rpc('session.respondHostAction', {
        actionId: action.actionId,
        claimToken: claimed.claimToken,
        outcome: 'succeeded',
        result: {},
      }),
    ).rejects.toThrow()

    release()
    client.close()
  })

  it('interrupt before claim cancels pending action', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const { rt, client, session, lease } = await setupStreamingSession(await boot(), held)
    const wait = rt.sessions.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser_snapshot',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      replayPolicy: 'safe',
      deadlineMs: 30_000,
    })
    await new Promise((r) => setTimeout(r, 20))
    await client.rpc('session.interrupt', {
      sessionId: session.sessionId,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    expect((await wait).state).toBe('cancelled')
    release()
    client.close()
  })

  it('session close settles host action waiters', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const { rt, client, session, lease } = await setupStreamingSession(await boot(), held)
    const wait = rt.sessions.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser_snapshot',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      replayPolicy: 'safe',
      deadlineMs: 30_000,
    })
    await new Promise((r) => setTimeout(r, 20))
    await client.rpc('session.close', {
      sessionId: session.sessionId,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    expect((await wait).state).toBe('cancelled')
    release()
    client.close()
  })

  it('identical respond is accepted; conflicting respond is rejected', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const { rt, client, session } = await setupStreamingSession(await boot(), held)
    const wait = rt.sessions.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser_snapshot',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: {},
      replayPolicy: 'safe',
      deadlineMs: 15_000,
    })
    await new Promise((r) => setTimeout(r, 20))
    const poll = (await client.rpc('session.hostActionsPoll', {})) as {
      outstanding: Array<{ actionId: string; version: number }>
    }
    const a = poll.outstanding[0]!
    const claimed = (await client.rpc('session.claimHostAction', {
      actionId: a.actionId,
      expectedVersion: a.version,
    })) as { claimToken: string }
    const payload = { content: [{ type: 'text', text: 'same' }] }
    const first = (await client.rpc('session.respondHostAction', {
      actionId: a.actionId,
      claimToken: claimed.claimToken,
      outcome: 'succeeded',
      result: payload,
    })) as { duplicate: boolean }
    expect(first.duplicate).toBe(false)
    const dup = (await client.rpc('session.respondHostAction', {
      actionId: a.actionId,
      claimToken: claimed.claimToken,
      outcome: 'succeeded',
      result: payload,
    })) as { duplicate: boolean }
    expect(dup.duplicate).toBe(true)
    await expect(
      client.rpc('session.respondHostAction', {
        actionId: a.actionId,
        claimToken: claimed.claimToken,
        outcome: 'succeeded',
        result: { content: [{ type: 'text', text: 'different' }] },
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect((await wait).state).toBe('succeeded')
    release()
    client.close()
  })
})
