import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

async function bootTail(): Promise<{
  rt: NodeRuntime
  projectDir: string
  client: Awaited<ReturnType<typeof connectAuthedRpc>>
  projectId: string
}> {
  const nodeHome = mkdtempSync(join(tmpdir(), 'tail-node-'))
  const projectDir = mkdtempSync(join(tmpdir(), 'tail-proj-'))
  dirs.push(nodeHome, projectDir)
  mkdirSync(join(projectDir, 'temp'), { recursive: true })
  writeFileSync(join(projectDir, 'temp', 'job.output'), 'hello')
  const port = 37000 + Math.floor(Math.random() * 1000)
  const rt = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    bindPort: port,
    simulatedHarness: true,
  })
  runtimes.push(rt)
  const client = await connectAuthedRpc(rt)
  const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
  return { rt, projectDir, client, projectId: project.projectId }
}

function decodeB64(content: string): string {
  return Buffer.from(content, 'base64').toString('utf8')
}

describe('workspace.tailWatch RPC', () => {
  it('start/poll returns appended bytes as the file grows', async () => {
    const { projectDir, client, projectId } = await bootTail()
    const started = (await client.rpc('workspace.tailWatchStart', {
      projectId,
      relativePath: 'temp/job.output',
      offset: 0,
    })) as { watchId: string; offset: number }
    expect(started.watchId).toBeTruthy()
    expect(started.offset).toBe(0)

    const first = (await client.rpc('workspace.tailWatchPoll', {
      watchId: started.watchId,
    })) as { content: string; encoding: string; offset: number; size: number }
    expect(first.encoding).toBe('base64')
    expect(decodeB64(first.content)).toBe('hello')
    expect(first.offset).toBe(Buffer.byteLength('hello'))

    appendFileSync(join(projectDir, 'temp', 'job.output'), '\nworld')
    const second = (await client.rpc('workspace.tailWatchPoll', {
      watchId: started.watchId,
    })) as { content: string; offset: number }
    expect(decodeB64(second.content)).toBe('\nworld')
    expect(second.offset).toBe(Buffer.byteLength('hello\nworld'))

    const empty = (await client.rpc('workspace.tailWatchPoll', {
      watchId: started.watchId,
    })) as { content: string; offset: number }
    expect(decodeB64(empty.content)).toBe('')
    expect(empty.offset).toBe(second.offset)

    const stop = (await client.rpc('workspace.tailWatchStop', {
      watchId: started.watchId,
    })) as { ok: boolean }
    expect(stop.ok).toBe(true)

    await expect(
      client.rpc('workspace.tailWatchPoll', { watchId: started.watchId }),
    ).rejects.toMatchObject({ code: 'not_found' })
    client.close()
  })

  it('rejects paths outside project and outside temp/', async () => {
    const { client, projectId } = await bootTail()

    await expect(
      client.rpc('workspace.tailWatchStart', {
        projectId,
        relativePath: 'src/a.ts',
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' })

    await expect(
      client.rpc('workspace.tailWatchStart', {
        projectId,
        relativePath: '../outside.output',
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' })

    await expect(
      client.rpc('workspace.tailWatchStart', {
        projectId,
        relativePath: '/etc/passwd',
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' })

    client.close()
  })

  it('same-key serial retry replays live watchId', async () => {
    const { client, projectId } = await bootTail()
    const key = 'tail-retry-1'
    const payload = { projectId, relativePath: 'temp/job.output', offset: 0 }
    const first = (await client.rpc('workspace.tailWatchStart', payload, key)) as {
      watchId: string
    }
    const second = (await client.rpc('workspace.tailWatchStart', payload, key)) as {
      watchId: string
    }
    expect(second.watchId).toBe(first.watchId)
    const polled = (await client.rpc('workspace.tailWatchPoll', { watchId: first.watchId })) as {
      content: string
    }
    expect(decodeB64(polled.content)).toBe('hello')
    client.close()
  })
})
