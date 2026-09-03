import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

async function freePortRuntime(): Promise<NodeRuntime> {
  const nodeHome = mkdtempSync(join(tmpdir(), 'superone-int-'))
  dirs.push(nodeHome)
  const runtime = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    // Ephemeral port: the OS picks a free one and the handle's `url` carries
    // it back, so parallel test files cannot collide.
    bindPort: 0,
    label: 'test-node', simulatedHarness: true })
  runtimes.push(runtime)
  return runtime
}

describe('node server integration', () => {
  it('serves health, pairs, and runs descriptor + terminal RPC over WebSocket', async () => {
    const runtime = await freePortRuntime()
    const baseUrl = runtime.server.url

    const health = await fetch(`${baseUrl}/health`)
    expect(health.status).toBe(200)
    const healthBody = (await health.json()) as { ok: boolean; environmentId: string }
    expect(healthBody.ok).toBe(true)
    expect(healthBody.environmentId).toBe(runtime.identity.environmentId)

    const client = await connectAuthedRpc(runtime)
    const descriptor = (await client.rpc('environment.descriptor')) as {
      environmentId: string
      capabilities: { terminal: boolean; sessions: boolean }
      nodePublicKeyFingerprint: string
    }
    expect(descriptor.environmentId).toBe(runtime.identity.environmentId)
    expect(descriptor.capabilities.terminal).toBe(true)
    expect(descriptor.capabilities.sessions).toBe(true)
    expect(descriptor.nodePublicKeyFingerprint).toBe(runtime.identity.publicKeyFingerprint)

    const healthRpc = (await client.rpc('environment.health')) as { ok: boolean }
    expect(healthRpc.ok).toBe(true)

    const created = (await client.rpc('terminal.create', {
      cwd: runtime.config.nodeHome,
      title: 't1',
    })) as { terminalId: string }
    expect(created.terminalId).toBeTruthy()

    const lease = (await client.rpc('terminal.acquireControl', {
      terminalId: created.terminalId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }

    const attached = (await client.rpc('terminal.attach', { terminalId: created.terminalId })) as {
      snapshot: string
      sequence: string
    }
    expect(attached.sequence).toBeDefined()

    await client.rpc('terminal.write', {
      terminalId: created.terminalId,
      data: 'pwd\r',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    type TerminalRead = {
      data: string
      sequence: string
      status: 'running' | 'exited'
    }
    let read: TerminalRead | null = null
    for (let attempt = 0; attempt < 240; attempt += 1) {
      read = (await client.rpc('terminal.read', {
        terminalId: created.terminalId,
        afterSequence: attached.sequence,
      })) as TerminalRead
      if (read?.data.includes(runtime.config.nodeHome)) break
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(read?.data).toContain(runtime.config.nodeHome)
    expect(read?.status).toBe('running')

    const attached2 = (await client.rpc('terminal.attach', { terminalId: created.terminalId })) as {
      snapshot: string
    }
    expect(attached2.snapshot).toContain(runtime.config.nodeHome)

    await client.rpc('terminal.kill', {
      terminalId: created.terminalId,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    client.close()
  })

  it('rejects websocket upgrade without a valid ticket', async () => {
    const runtime = await freePortRuntime()
    const wsUrl = runtime.server.url.replace(/^http/, 'ws') + '/ws'
    const { default: WS } = await import('ws')
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WS(wsUrl, {
          headers: { 'x-superone-ws-ticket': 'bogus.ticket' },
        })
        ws.once('open', () => {
          ws.close()
          resolve()
        })
        ws.once('error', (err: Error) => reject(err))
        ws.once('unexpected-response', () => reject(new Error('unauthorized')))
      }),
    ).rejects.toBeTruthy()
  })
})
