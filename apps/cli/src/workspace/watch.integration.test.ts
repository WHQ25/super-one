import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function bootWatch(): Promise<{
  rt: NodeRuntime
  projectDir: string
  client: Awaited<ReturnType<typeof connectAuthedRpc>>
  projectId: string
}> {
  const nodeHome = mkdtempSync(join(tmpdir(), 'watch-node-'))
  const projectDir = mkdtempSync(join(tmpdir(), 'watch-proj-'))
  dirs.push(nodeHome, projectDir)
  writeFileSync(join(projectDir, 'a.txt'), 'a')
  const rt = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    // Ephemeral port: the OS picks a free one and the handle's `url` carries
    // it back, so parallel test files cannot collide.
    bindPort: 0,
    simulatedHarness: true,
  })
  runtimes.push(rt)
  const client = await connectAuthedRpc(rt)
  const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
  return { rt, projectDir, client, projectId: project.projectId }
}

describe('workspace.watch RPC', () => {
  it('start/poll/stop works on the real node server', async () => {
    const { projectDir, client, projectId } = await bootWatch()
    const started = (await client.rpc('workspace.watchStart', {
      projectId,
      relativePath: '.',
    })) as { watchId: string }
    expect(started.watchId).toBeTruthy()

    writeFileSync(join(projectDir, 'b.txt'), 'b')
    for (let i = 0; i < 10; i++) {
      await client.rpc('workspace.watchPoll', { watchId: started.watchId })
      await new Promise((r) => setTimeout(r, 30))
    }
    const stop = (await client.rpc('workspace.watchStop', { watchId: started.watchId })) as {
      ok: boolean
    }
    expect(stop.ok).toBe(true)
    client.close()
  })

  it('same-key serial retry replays live watchId without a second subscribe', async () => {
    const { client, projectId } = await bootWatch()
    const key = 'watch-retry-key-1'
    const payload = { projectId, relativePath: '.' }
    const first = (await client.rpc('workspace.watchStart', payload, key)) as { watchId: string }
    const second = (await client.rpc('workspace.watchStart', payload, key)) as { watchId: string }
    expect(second.watchId).toBe(first.watchId)

    // Poll must still work against the replayed id (watcher still live).
    const polled = (await client.rpc('workspace.watchPoll', { watchId: first.watchId })) as {
      events: unknown[]
    }
    expect(Array.isArray(polled.events)).toBe(true)
    client.close()
  })

  it('same-key different payload conflicts', async () => {
    const { client, projectId } = await bootWatch()
    const key = 'watch-conflict-key'
    await client.rpc('workspace.watchStart', { projectId, relativePath: '.' }, key)
    await expect(
      client.rpc('workspace.watchStart', { projectId, relativePath: 'src' }, key),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' })
    client.close()
  })

  it('after stop, same key recreates a live watcher instead of replaying dead id', async () => {
    const { client, projectId } = await bootWatch()
    const key = 'watch-after-stop-key'
    const payload = { projectId, relativePath: '.' }
    const first = (await client.rpc('workspace.watchStart', payload, key)) as { watchId: string }
    await client.rpc('workspace.watchStop', { watchId: first.watchId })
    await expect(
      client.rpc('workspace.watchPoll', { watchId: first.watchId }),
    ).rejects.toMatchObject({ code: 'not_found' })

    const second = (await client.rpc('workspace.watchStart', payload, key)) as { watchId: string }
    expect(second.watchId).not.toBe(first.watchId)
    const polled = (await client.rpc('workspace.watchPoll', { watchId: second.watchId })) as {
      events: unknown[]
    }
    expect(Array.isArray(polled.events)).toBe(true)
    client.close()
  })
})
