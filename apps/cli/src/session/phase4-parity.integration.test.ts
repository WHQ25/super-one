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

async function boot(opts?: { simulatedHarness?: boolean }) {
  const nodeHome = mkdtempSync(join(tmpdir(), 'p4-node-'))
  dirs.push(nodeHome)
  const port = 29000 + Math.floor(Math.random() * 5000)
  const rt = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    bindPort: port,
    simulatedHarness: opts?.simulatedHarness !== false,
  })
  runtimes.push(rt)
  return rt
}

describe('Phase 4 harness parity + collaboration', () => {
  it('descriptor advertises all four harnesses and each can complete a turn', async () => {
    const rt = await boot({ simulatedHarness: true })
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

  it('descriptor.capabilities.collaboration is true without simulatedHarness', async () => {
    const rt = await boot({ simulatedHarness: false })
    const client = await connectAuthedRpc(rt)
    const descriptor = (await client.rpc('environment.descriptor')) as {
      capabilities: { collaboration: boolean }
    }
    expect(descriptor.capabilities.collaboration).toBe(true)
    client.close()
  })

  it('collaboration.request/start/send/retrieve succeed without simulatedHarness and survive restart', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'p4-collab-'))
    dirs.push(nodeHome)
    // Node-local collab is gated by experimentalAgentCollaborationEnabled.
    writeFileSync(
      join(nodeHome, 'config.json'),
      JSON.stringify({ agent: { experimentalAgentCollaborationEnabled: true } }, null, 2),
    )
    const port = 29500 + Math.floor(Math.random() * 500)
    // Production-like: no simulated harness gate for collab.
    const rt = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      bindPort: port,
      simulatedHarness: false,
      // Allow turns so start can deliver the initial task without a real binary.
      allowSimulatedTurnFallback: true,
      turnRunner: async ({ onDelta }) => {
        onDelta('[collab] done')
        return { finalText: '[collab] done' }
      },
    })
    runtimes.push(rt)

    const projectDir = mkdtempSync(join(tmpdir(), 'p4-cproj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'a'), '1')

    const client = await connectAuthedRpc(rt)
    const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }
    // session.create still needs a ready harness; enable simulated overlay only for create.
    // Use multi-harness path: boot with allowSimulated and pre-create via runtime API if needed.
    // Here we enable harness overlay mid-test via a second node is not possible; create session
    // through SessionRuntime directly when catalog is not ready.
    const parent = rt.sessions.create({
      projectId: project.projectId,
      harnessId: 'claude',
      providerId: 'claude',
      title: 'parent',
      controllerClientSessionId: 'test-controller',
    })

    const profiles = (await client.rpc('collaboration.listProfiles')) as Array<{ id: string }>
    expect(profiles.length).toBeGreaterThan(0)
    const agentId = profiles.find((p) => p.id === 'claude')?.id ?? profiles[0].id

    const lease = (await client.rpc('session.acquireControl', {
      sessionId: parent.sessionId,
      ttlMs: 60_000,
    })) as { leaseId: string; generation: string }

    const requested = (await client.rpc('collaboration.request', {
      parentSessionId: parent.sessionId,
      leaseId: lease.leaseId,
      generation: lease.generation,
      launches: [
        {
          launchId: 'launch-1',
          agentId,
          task: 'Please review the change',
          name: 'Reviewer',
          role: 'Diff Reviewer',
          config: { cwd: projectDir },
        },
      ],
    })) as {
      status: string
      launches: Array<{ credential: string; grantId: string; launchId: string }>
    }
    expect(requested.status).toBe('approved')
    expect(requested.launches).toHaveLength(1)
    const { credential, grantId } = requested.launches[0]
    expect(credential.startsWith('s1sc_')).toBe(true)
    expect(grantId).toBeTruthy()

    const started = (await client.rpc('collaboration.start', {
      credential,
      callerSessionId: parent.sessionId,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })) as {
      status: string
      sessionId: string
      reused: boolean
    }
    expect(started.status).toBe('started')
    expect(started.reused).toBe(false)
    expect(started.sessionId).toBeTruthy()

    const startedAgain = (await client.rpc('collaboration.start', {
      grantId,
      callerSessionId: parent.sessionId,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })) as {
      sessionId: string
      reused: boolean
    }
    expect(startedAgain.sessionId).toBe(started.sessionId)
    expect(startedAgain.reused).toBe(true)

    const sent = (await client.rpc('collaboration.send', {
      credential,
      sessionId: parent.sessionId,
      content: '## Handoff\nplease continue',
      clientMessageId: 'msg-1',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })) as { status: string; messageId: string; sequence: number; reused: boolean }
    expect(sent.status).toBe('sent')
    expect(sent.reused).toBe(false)

    const sentAgain = (await client.rpc('collaboration.send', {
      credential,
      sessionId: parent.sessionId,
      content: '## Handoff\nplease continue',
      clientMessageId: 'msg-1',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })) as { messageId: string; reused: boolean }
    expect(sentAgain.reused).toBe(true)
    expect(sentAgain.messageId).toBe(sent.messageId)

    const retrieved = (await client.rpc('collaboration.retrieve', {
      credential,
      sessionId: started.sessionId,
      max: 10,
    })) as {
      status: string
      messages: Array<{ messageId: string; content: string; sequence: number }>
    }
    expect(retrieved.status).toBe('messages')
    expect(retrieved.messages.some((m) => m.messageId === sent.messageId)).toBe(true)
    expect(retrieved.messages[0].content).toContain('please continue')

    // Cursor advanced — second retrieve is empty.
    const empty = (await client.rpc('collaboration.retrieve', {
      credential,
      sessionId: started.sessionId,
    })) as { status: string; messages: unknown[] }
    expect(empty.status).toBe('empty')
    expect(empty.messages).toHaveLength(0)

    client.close()
    await rt.stop()
    runtimes.pop()

    const rt2 = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      bindPort: port + 1,
      simulatedHarness: false,
      allowSimulatedTurnFallback: true,
    })
    runtimes.push(rt2)

    // Durable mailbox rows survive restart under SUPERONE_NODE_HOME state.sqlite.
    const surviving = rt2.db
      .prepare(
        `SELECT id, content FROM session_collaboration_messages WHERE credential_hash = ?`,
      )
      .all(grantId) as Array<{ id: string; content: string }>
    expect(surviving.some((m) => m.id === sent.messageId && m.content.includes('please continue'))).toBe(
      true,
    )
    const grantRow = rt2.db
      .prepare(`SELECT child_session_id, task_sent FROM session_collaboration_grants WHERE credential_hash = ?`)
      .get(grantId) as { child_session_id: string; task_sent: number }
    expect(grantRow.child_session_id).toBe(started.sessionId)
    expect(grantRow.task_sent).toBe(1)
  })
})
