/**
 * topic.subscribe: catch-up from a cursor, then pushes as events commit,
 * filtered by topic, until unsubscribed.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionStreamMessage } from '@superone/shared/environment'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.stop().catch(() => {})
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function boot() {
  const nodeHome = mkdtempSync(join(tmpdir(), 'sub-node-'))
  const projectDir = mkdtempSync(join(tmpdir(), 'sub-proj-'))
  dirs.push(nodeHome, projectDir)
  const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true })
  runtimes.push(rt)
  const client = await connectAuthedRpc(rt)
  const project = (await client.rpc('project.open', { path: projectDir, name: 'p' })) as { projectId: string }
  return { client, project }
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10))
  expect(check()).toBe(true)
}

describe('topic.subscribe', () => {
  it('pushes the events after the cursor, then each new one, for the subscribed session only', async () => {
    const { client, project } = await boot()
    const a = (await client.rpc('session.create', { projectId: project.projectId, harnessId: 'claude' })) as { sessionId: string }
    const b = (await client.rpc('session.create', { projectId: project.projectId, harnessId: 'claude' })) as { sessionId: string }
    const frames: SessionStreamMessage['frame'][] = []
    client.onMessage((msg) => {
      if (msg.type === 'stream' && msg.subscriptionId === 'sub-1') frames.push((msg as unknown as SessionStreamMessage).frame)
    })

    const { environmentId } = (await client.rpc('environment.descriptor')) as { environmentId: string }
    await client.rpc('topic.subscribe', { subscriptionId: 'sub-1', afterSequence: '0', topics: [{ kind: 'session', environmentId, sessionId: a.sessionId }] })
    expect(frames.flatMap((f) => f.events.map((e) => e.eventType))).toContain('session.created')
    expect(frames.flatMap((f) => f.events.map((e) => e.aggregateId))).not.toContain(b.sessionId)

    const seen = frames.length
    await client.rpc('session.rename', { sessionId: b.sessionId, title: 'other' })
    await client.rpc('session.rename', { sessionId: a.sessionId, title: 'mine' })
    await until(() => frames.length > seen)
    expect(frames.slice(seen).flatMap((f) => f.events.map((e) => [e.aggregateId, e.eventType])))
      .toEqual([[a.sessionId, 'session.renamed']])

    await client.rpc('topic.unsubscribe', { subscriptionId: 'sub-1' })
    const after = frames.length
    await client.rpc('session.rename', { sessionId: a.sessionId, title: 'again' })
    await new Promise((r) => setTimeout(r, 50))
    expect(frames).toHaveLength(after)
  })

  it('refuses a cursor that is not a decimal sequence, and a subscribe without topics', async () => {
    const { client } = await boot()
    await expect(client.rpc('topic.subscribe', { subscriptionId: 's', afterSequence: 'x', topics: [{ kind: 'sessionList', environmentId: 'e' }] })).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(client.rpc('topic.subscribe', { subscriptionId: 's', afterSequence: '0' })).rejects.toMatchObject({ code: 'invalid_argument' })
  })
})
