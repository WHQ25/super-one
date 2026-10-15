/**
 * session.create `continuesFrom` — a new session continuing an old one
 * (docs/features/session-continuation.md).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.stop().catch(() => {})
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function boot() {
  const nodeHome = mkdtempSync(join(tmpdir(), 'continue-node-'))
  const projectDir = mkdtempSync(join(tmpdir(), 'continue-project-'))
  dirs.push(nodeHome, projectDir)
  const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true })
  runtimes.push(rt)
  const client = await connectAuthedRpc(rt)
  const { projectId } = await client.rpc('project.open', { path: projectDir, name: 'p' }) as { projectId: string }
  const create = (extra: Record<string, unknown> = {}) =>
    client.rpc('session.create', { projectId, harnessId: 'claude', ...extra }, crypto.randomUUID()) as Promise<{ sessionId: string }>
  return { rt, create }
}

describe('session.create continuesFrom', () => {
  it('records the continuation once and refuses a second one or an unknown session', async () => {
    const { rt, create } = await boot()
    const old = await create()

    const next = await create({ continuesFrom: old.sessionId })

    expect(rt.collaboration.successorOf(old.sessionId)).toBe(next.sessionId)
    await expect(create({ continuesFrom: old.sessionId })).rejects.toMatchObject({ code: 'failed_precondition' })
    await expect(create({ continuesFrom: 'missing' })).rejects.toMatchObject({ code: 'not_found' })
  })
})
