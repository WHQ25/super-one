/**
 * artifact.* RPC over a real node runtime — the node half of the session sync
 * zone. The desktop pushes Host Action outputs here before the agent reads
 * them and pulls agent-written files back lazily; both are gated on the
 * controller binding, and writes additionally on the session lease.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ArtifactGetResult, ArtifactStatResult, ExecutionEnvironmentDescriptor } from '@superone/shared/environment'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
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

type Client = Awaited<ReturnType<typeof connectAuthedRpc>>

async function boot() {
  const nodeHome = mkdtempSync(join(tmpdir(), 'artifact-node-'))
  dirs.push(nodeHome)
  const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true })
  runtimes.push(rt)
  return { rt, nodeHome }
}

async function openSession(client: Client) {
  const projectDir = mkdtempSync(join(tmpdir(), 'artifact-proj-'))
  dirs.push(projectDir)
  writeFileSync(join(projectDir, 'f.txt'), 'x')
  const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
  const session = (await client.rpc('session.create', { projectId: project.projectId, harnessId: 'codex' })) as { sessionId: string }
  const lease = (await client.rpc('session.acquireControl', { sessionId: session.sessionId, ttlMs: 60_000 })) as { leaseId: string; generation: string }
  return { sessionId: session.sessionId, lease }
}

async function failure(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (err) {
    return (err as { code?: string }).code
  }
  return undefined
}

describe('artifact RPC on a node', () => {
  it('advertises the zone root and pushes, stats, pulls and deletes a session artifact', async () => {
    const { rt, nodeHome } = await boot()
    const client = await connectAuthedRpc(rt)
    const descriptor = (await client.rpc('environment.descriptor')) as ExecutionEnvironmentDescriptor
    expect(descriptor.capabilities.syncZone).toBe(true)
    expect(descriptor.syncRoot).toBe(join(nodeHome, 'sync'))

    const { sessionId, lease } = await openSession(client)
    const data = Buffer.from('screenshot bytes')
    const sha256 = createHash('sha256').update(data).digest('hex')
    const put = (offset: number, end: number, final: boolean) => client.rpc('artifact.put', {
      sessionId, relativePath: 'browser/shot.png', transferId: 'up-1', offset, total: data.length, sha256,
      chunk: data.subarray(offset, end).toString('base64'), final, ...lease,
    })
    expect(await put(0, 10, false)).toEqual({ ok: true, bytesWritten: 10 })
    expect(((await client.rpc('artifact.stat', { sessionId, relativePath: 'browser/shot.png' })) as ArtifactStatResult).exists).toBe(false)
    expect(await put(10, data.length, true)).toEqual({ ok: true, bytesWritten: data.length })

    const twin = join(nodeHome, 'sync', sessionId, 'browser', 'shot.png')
    expect(readFileSync(twin)).toEqual(data)
    const stat = (await client.rpc('artifact.stat', { sessionId, relativePath: 'browser/shot.png' })) as ArtifactStatResult
    expect(stat).toMatchObject({ exists: true, size: data.length })

    const got = (await client.rpc('artifact.get', { sessionId, relativePath: 'browser/shot.png', offset: 0, maxBytes: 1024 })) as ArtifactGetResult
    expect(Buffer.from(got.chunk, 'base64')).toEqual(data)
    expect(got).toMatchObject({ total: data.length, eof: true, mtimeMs: stat.mtimeMs })

    expect(await client.rpc('artifact.delete', { sessionId, relativePath: 'browser/shot.png', ...lease })).toEqual({ ok: true })
    expect(existsSync(twin)).toBe(false)
    expect(await client.rpc('artifact.delete', { sessionId, ...lease })).toEqual({ ok: true })
    expect(existsSync(join(nodeHome, 'sync', sessionId))).toBe(false)
    client.close()
  })

  it('serves stat and get to the controller without a lease but refuses put and delete without one', async () => {
    const { rt } = await boot()
    const client = await connectAuthedRpc(rt)
    const { sessionId } = await openSession(client)
    const data = Buffer.from('x')
    const sha256 = createHash('sha256').update(data).digest('hex')
    const unleased = { sessionId, relativePath: 'agent/a.txt', transferId: 't', offset: 0, total: 1, sha256, chunk: data.toString('base64'), final: true }
    // The session already holds a lease (openSession acquired one), so a missing proof reads as stale.
    expect(await failure(client.rpc('artifact.put', unleased))).toMatch(/^lease_(required|stale)$/)
    expect(await failure(client.rpc('artifact.delete', { sessionId }))).toMatch(/^lease_(required|stale)$/)
    expect(await client.rpc('artifact.stat', { sessionId, relativePath: 'agent/a.txt' })).toEqual({ exists: false, size: 0, mtimeMs: 0 })
    client.close()
  })

  it('refuses another paired client, an unknown session, and a path that leaves the session zone', async () => {
    const { rt, nodeHome } = await boot()
    const controller = await connectAuthedRpc(rt, 'controller')
    const stranger = await connectAuthedRpc(rt, 'stranger')
    const { sessionId, lease } = await openSession(controller)
    writeFileSync(join(nodeHome, 'secret.txt'), 'nope')

    expect(await failure(stranger.rpc('artifact.stat', { sessionId, relativePath: 'browser/a.png' }))).toBe('forbidden')
    expect(await failure(controller.rpc('artifact.stat', { sessionId: 'no-such-session', relativePath: 'browser/a.png' }))).toBe('not_found')
    expect(await failure(controller.rpc('artifact.get', { sessionId, relativePath: '../../secret.txt', offset: 0, maxBytes: 10 }))).toBe('invalid_argument')
    expect(await failure(controller.rpc('artifact.put', {
      sessionId, relativePath: '../other/x', transferId: 't', offset: 0, total: 1,
      sha256: createHash('sha256').update('x').digest('hex'), chunk: Buffer.from('x').toString('base64'), final: true, ...lease,
    }))).toBe('invalid_argument')
    controller.close()
    stranger.close()
  })

  it('removes the session zone directory when the session itself is removed', async () => {
    const { rt, nodeHome } = await boot()
    const client = await connectAuthedRpc(rt)
    const { sessionId, lease } = await openSession(client)
    const data = Buffer.from('keep?')
    await client.rpc('artifact.put', {
      sessionId, relativePath: 'agent/report.md', transferId: 't', offset: 0, total: data.length,
      sha256: createHash('sha256').update(data).digest('hex'), chunk: data.toString('base64'), final: true, ...lease,
    })
    expect(existsSync(join(nodeHome, 'sync', sessionId, 'agent', 'report.md'))).toBe(true)
    await client.rpc('session.close', { sessionId, ...lease })
    await client.rpc('session.remove', { sessionId })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(existsSync(join(nodeHome, 'sync', sessionId))).toBe(false)
    client.close()
  })
})
