import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { PHASE4_HARNESS_IDS } from './harness-runners'
import type { HarnessId } from '@superone/shared/session-types'
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

async function boot() {
  const nodeHome = mkdtempSync(join(tmpdir(), 'p4-node-'))
  dirs.push(nodeHome)
  const port = 29000 + Math.floor(Math.random() * 5000)
  const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: port, simulatedHarness: true })
  runtimes.push(rt)
  return rt
}

describe('Phase 4 harness parity + collaboration', () => {
  it('descriptor advertises all four harnesses and each can complete a turn', async () => {
    const rt = await boot()
    const client = await connectAuthedRpc(rt)
    const descriptor = (await client.rpc('environment.descriptor')) as {
      capabilities: { harnessIds: HarnessId[]; collaboration: boolean }
    }
    expect(descriptor.capabilities.harnessIds).toEqual(PHASE4_HARNESS_IDS)
    expect(descriptor.capabilities.collaboration).toBe(true)

    const projectDir = mkdtempSync(join(tmpdir(), 'p4-proj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'x'), '1')
    const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }

    for (const harnessId of PHASE4_HARNESS_IDS) {
      const session = (await client.rpc('session.create', {
        projectId: project.projectId,
        harnessId,
        providerId: harnessId,
      })) as { sessionId: string }
      const lease = (await client.rpc('session.acquireControl', {
        sessionId: session.sessionId,
        ttlMs: 30_000,
      })) as { leaseId: string; generation: string }
      await client.rpc('session.send', {
        sessionId: session.sessionId,
        text: `hello ${harnessId}`,
        leaseId: lease.leaseId,
        generation: lease.generation,
      })
      let status = 'streaming'
      let transcriptText = ''
      for (let i = 0; i < 40; i++) {
        const s = (await client.rpc('session.get', { sessionId: session.sessionId })) as {
          status: string
          transcript: Array<{ text: string }>
        }
        status = s.status
        transcriptText = s.transcript.map((t) => t.text).join('')
        if (status === 'idle') break
        await new Promise((r) => setTimeout(r, 25))
      }
      expect(status).toBe('idle')
      expect(transcriptText).toContain(`[${harnessId}]`)
    }
    client.close()
  })

  it('collaboration mailbox survives node restart', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'p4-collab-'))
    dirs.push(nodeHome)
    const port = 29500 + Math.floor(Math.random() * 500)
    const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: port, simulatedHarness: true })
    runtimes.push(rt)

    const projectDir = mkdtempSync(join(tmpdir(), 'p4-cproj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'a'), '1')

    const client = await connectAuthedRpc(rt)
    const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
    const parent = (await client.rpc('session.create', {
      projectId: project.projectId,
      title: 'parent',
    })) as { sessionId: string }
    const child = (await client.rpc('session.create', {
      projectId: project.projectId,
      title: 'child',
    })) as { sessionId: string }

    const lease = (await client.rpc('session.acquireControl', {
      sessionId: parent.sessionId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }

    const msg = (await client.rpc('collaboration.send', {
      fromSessionId: parent.sessionId,
      toSessionId: child.sessionId,
      mailbox: 'agent',
      body: { type: 'handoff', text: 'please continue' },
      leaseId: lease.leaseId,
      generation: lease.generation,
    })) as { messageId: string }

    const listed = (await client.rpc('collaboration.list', { mailbox: 'agent' })) as Array<{
      messageId: string
      body: { text: string }
    }>
    expect(listed.some((m) => m.messageId === msg.messageId)).toBe(true)
    client.close()
    await rt.stop()
    runtimes.pop()

    const rt2 = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: port + 1, simulatedHarness: true })
    runtimes.push(rt2)
    const surviving = rt2.collaboration.list({ mailbox: 'agent' })
    expect(
      surviving.some(
        (m) => m.messageId === msg.messageId && (m.body as { text: string }).text === 'please continue',
      ),
    ).toBe(true)
  })
})
