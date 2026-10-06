/**
 * A chat attachment's full-size original reaches the node through the session
 * sync zone before its message; `session.send` names it and the turn reads it.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { TurnImageAttachment } from '@superone/runtime/session'
import type { TurnRunner } from '../session/session-runtime'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  for (const rt of runtimes.splice(0)) await rt.stop().catch(() => {})
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function setup() {
  const turns: Array<TurnImageAttachment[] | undefined> = []
  const turnRunner: TurnRunner = async ({ images, onDelta }) => {
    turns.push(images)
    onDelta('ok')
    return { finalText: 'ok' }
  }
  const nodeHome = mkdtempSync(join(tmpdir(), 'attachment-node-'))
  const projectDir = mkdtempSync(join(tmpdir(), 'attachment-proj-'))
  dirs.push(nodeHome, projectDir)
  const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true, turnRunner })
  runtimes.push(rt)
  const client = await connectAuthedRpc(rt)
  const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
  const { sessionId } = (await client.rpc('session.create', { projectId: project.projectId, harnessId: 'codex' })) as { sessionId: string }
  const lease = (await client.rpc('session.acquireControl', { sessionId, ttlMs: 60_000 })) as { leaseId: string; generation: string }
  return { client, nodeHome, sessionId, lease, turns }
}

it('hands the turn the original uploaded into this session zone', async () => {
  const { client, nodeHome, sessionId, lease, turns } = await setup()
  const data = Buffer.from('full-size image bytes')
  await client.rpc('artifact.put', {
    sessionId, relativePath: 'attachment/full.png', transferId: 'up-1', offset: 0, total: data.length,
    sha256: createHash('sha256').update(data).digest('hex'), chunk: data.toString('base64'), final: true, ...lease,
  })
  const originalPath = join(nodeHome, 'sync', sessionId, 'attachment', 'full.png')
  await client.rpc('session.send', { sessionId, text: 'edit this', ...lease,
    options: { images: [{ name: 'full.png', mimeType: 'image/png', base64: PNG, originalPath }] } })
  await expect.poll(() => turns.length).toBe(1)
  expect(turns[0]?.[0]).toMatchObject({ name: 'full.png', originalPath: realpathSync(originalPath) })
  client.close()
})

it('refuses an original outside the session zone or not there', async () => {
  const { client, nodeHome, sessionId, lease, turns } = await setup()
  const outside = join(nodeHome, 'elsewhere.png')
  writeFileSync(outside, 'x')
  for (const originalPath of [outside, join(nodeHome, 'sync', sessionId, 'attachment', 'missing.png'), join(nodeHome, 'sync', sessionId, '..', 'elsewhere.png')]) {
    await expect(client.rpc('session.send', { sessionId, text: 'edit this', ...lease,
      options: { images: [{ name: 'x.png', mimeType: 'image/png', base64: PNG, originalPath }] } })).rejects.toMatchObject({ code: 'invalid_argument' })
  }
  expect(turns).toHaveLength(0)
  client.close()
})
