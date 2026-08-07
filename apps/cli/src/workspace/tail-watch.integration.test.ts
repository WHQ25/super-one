import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

  it('tails absolute Grok chat_history under HOME agent roots', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tail-home-'))
    dirs.push(home)
    const transcript = join(home, '.grok', 'sessions', 'sa-abs', 'chat_history.jsonl')
    mkdirSync(dirname(transcript), { recursive: true })
    writeFileSync(transcript, '{"type":"assistant","tool_calls":[]}\n')

    const prevHome = process.env.HOME
    process.env.HOME = home
    try {
      const { client, projectId } = await bootTail()
      const started = (await client.rpc('workspace.tailWatchStart', {
        projectId,
        relativePath: '',
        absolutePath: transcript,
        offset: 0,
      })) as { watchId: string; absolutePath?: string }
      expect(started.watchId).toBeTruthy()
      expect(started.absolutePath).toBeTruthy()

      const first = (await client.rpc('workspace.tailWatchPoll', {
        watchId: started.watchId,
      })) as { content: string; encoding: string }
      expect(first.encoding).toBe('base64')
      expect(decodeB64(first.content)).toContain('tool_calls')

      appendFileSync(transcript, '{"type":"tool_result","tool_call_id":"x"}\n')
      const second = (await client.rpc('workspace.tailWatchPoll', {
        watchId: started.watchId,
      })) as { content: string }
      expect(decodeB64(second.content)).toContain('tool_result')

      await client.rpc('workspace.tailWatchStop', { watchId: started.watchId })
      client.close()
    } finally {
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
    }
  })

  it('rejects absolutePath symlink that escapes agent roots', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tail-home-sym-'))
    dirs.push(home)
    const sessions = join(home, '.grok', 'sessions', 'sa-sym')
    mkdirSync(sessions, { recursive: true })
    const outside = join(home, 'secret.txt')
    writeFileSync(outside, 'secret')
    const link = join(sessions, 'chat_history.jsonl')
    symlinkSync(outside, link)

    const prevHome = process.env.HOME
    process.env.HOME = home
    try {
      const { client, projectId } = await bootTail()
      await expect(
        client.rpc('workspace.tailWatchStart', {
          projectId,
          relativePath: '',
          absolutePath: link,
          offset: 0,
        }),
      ).rejects.toMatchObject({ code: 'invalid_argument' })

      await expect(
        client.rpc('workspace.tailWatchStart', {
          projectId,
          relativePath: '',
          absolutePath: '/etc/passwd',
          offset: 0,
        }),
      ).rejects.toMatchObject({ code: 'invalid_argument' })

      client.close()
    } finally {
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
    }
  })
})
