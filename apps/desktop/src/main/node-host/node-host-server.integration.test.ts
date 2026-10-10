import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, RecentFolder } from '@superone/shared/agent-types'
import type { EnvironmentEventEnvelope, ExecutionEnvironmentDescriptor, ProjectSnapshot } from '@superone/shared/environment'
import { HarnessManager } from '@superone/runtime/harness'
import { openNodeDatabase } from '@superone/runtime/db'

const electron = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `b-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => {
      const v = electron.store.get(buf.toString())
      if (v === undefined) throw new Error('missing')
      return v
    },
  },
}))
vi.mock('../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { NodeConnectionManager } from '../environment/node-connection-manager'
import { RemoteHostActionConsumer } from '../environment/remote-host-action-consumer'
import { NodeCredentialStore } from '../environment/node-credential-store'
import { createDesktopProjectsPort } from './desktop-projects-port'
import { nodeControllerDeviceId } from './desktop-session-host'
import { AGENT_PROFILES, FakeSessionManager, memoryStore, startDesktopNode, stopDesktopNode, type FakeSession } from './node-host-test-fixtures'
import { DesktopNodeHost } from './node-host-server'
import { mapNodeSessionEvents } from '@superone/shared/node-session-event-map'

const dirs: string[] = []
const hosts: DesktopNodeHost[] = []
const managers: NodeConnectionManager[] = []

afterEach(async () => {
  for (const m of managers.splice(0)) m.disconnectAll()
  for (const h of hosts.splice(0)) await stopDesktopNode(h)
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  electron.store.clear()
})

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

/** B with one git project (origin + a commit), paired with a fresh A. */
async function pairedDesktops() {
  const userData = tempDir('superone-node-host-')
  const projectDir = tempDir('superone-node-host-project-')
  execFileSync('git', ['init', '-q', projectDir])
  execFileSync('git', ['-C', projectDir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'])
  execFileSync('git', ['-C', projectDir, 'remote', 'add', 'origin', 'https://example.com/acme/app.git'])
  const folders: RecentFolder[] = [{ id: 'p1', path: projectDir, name: 'app', addedAt: '', lastOpened: new Date().toISOString() }]
  const projects = createDesktopProjectsPort({ list: () => folders, add: () => {} })
  const sessions = new FakeSessionManager()
  const store = memoryStore(() => projects.list())
  const harnesses = new HarnessManager(openNodeDatabase(':memory:'))
  harnesses.enableSimulatedOverlay()
  const host = await startDesktopNode(
    {
      userDataDir: userData, label: 'Desktop B', appVersion: '0.0.0-test', sessions, store, projects, harnesses,
      listAgentProfiles: () => AGENT_PROFILES,
      hooks: {
        probeHarnessReadiness: () => ({ ok: true }) as never,
        assertSessionHarnessRuntimeReady: () => ({ ok: true, reason: 'test' }),
      },
    },
    { bindPort: 23000 + Math.floor(Math.random() * 10000) },
  )
  hosts.push(host)
  const pairing = host.mintPairingToken()
  const manager = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(tempDir('superone-desktop-a-')) })
  managers.push(manager)
  const { connectionId } = await manager.pairAndConnect({ baseUrl: pairing.url, pairingToken: pairing.pairingToken, label: 'Desktop A', channel: pairing.channel })
  return { host, sessions, store, projectDir, connectionId, client: manager.getClient(connectionId)! }
}

describe('DesktopNodeHost', () => {
  it('serves projects and controller-owned sessions with a durable event log across restarts', async () => {
    const userData = tempDir('superone-node-host-')
    const projectDir = tempDir('superone-node-host-project-')
    execFileSync('git', ['init', '-q', projectDir])
    execFileSync('git', ['-C', projectDir, 'remote', 'add', 'origin', 'https://example.com/acme/app.git'])
    const folders: RecentFolder[] = [{ id: 'p1', path: projectDir, name: 'app', addedAt: '', lastOpened: new Date().toISOString() }]
    const projects = createDesktopProjectsPort({ list: () => folders, add: () => {} })
    const sessions = new FakeSessionManager()
    const store = memoryStore(() => projects.list())
    const harnesses = new HarnessManager(openNodeDatabase(':memory:'))
    harnesses.enableSimulatedOverlay()
    const port = 23000 + Math.floor(Math.random() * 10000)
    const start = (bindPort: number) => startDesktopNode(
      {
        userDataDir: userData,
        label: 'Desktop B',
        appVersion: '0.0.0-test',
        sessions,
        store,
        projects,
        harnesses,
        listAgentProfiles: () => AGENT_PROFILES,
        hooks: {
          probeHarnessReadiness: () => ({ ok: true }) as never,
          assertSessionHarnessRuntimeReady: () => ({ ok: true, reason: 'test' }),
        },
      },
      { bindPort },
    )

    let host = await start(port)
    hosts.push(host)
    expect(host.url).toContain('127.0.0.1')

    const pairing = host.mintPairingToken()
    // Pairing outside the encrypted channel is refused.
    const plain = await fetch(`${pairing.url}/v1/pair`, { method: 'POST', body: JSON.stringify({ pairingToken: pairing.pairingToken }), headers: { 'content-type': 'application/json', connection: 'close' } })
    expect(plain.status).toBe(403)
    const manager = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(tempDir('superone-desktop-a-')) })
    managers.push(manager)
    const { connectionId, descriptor } = await manager.pairAndConnect({ baseUrl: pairing.url, pairingToken: pairing.pairingToken, label: 'Desktop A', channel: pairing.channel })
    expect(descriptor.environmentId).toBe(host.identity.environmentId)
    const client = manager.getClient(connectionId)!

    const described = await client.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(described.capabilities.methods).toContain('session.get')
    for (const method of ['terminal.create', 'workspace.readFile', 'git.status', 'collaboration.send']) expect(described.capabilities.methods).not.toContain(method)
    expect(described.capabilities.harnessIds).toContain('claude')

    const listed = await client.rpc<ProjectSnapshot[]>('project.list')
    expect(listed).toEqual([expect.objectContaining({ projectId: 'p1', repoIdentity: 'git:https://example.com/acme/app.git' })])

    const created = await client.rpc<{ sessionId: string; controllerClientSessionId: string }>('session.create', {
      projectId: 'p1', harnessId: 'claude', title: 'child', systemPromptAppend: 'report back', permissionMode: 'acceptEdits',
    })
    const live = sessions.live.get(created.sessionId)!
    // Owned by the controller: this desktop's own UI cannot send into it, and its own active session is kept.
    expect(live.owner).toEqual({ kind: 'remote', deviceId: nodeControllerDeviceId(created.controllerClientSessionId) })
    expect(sessions.active).toBe('local-session')
    expect(store.rows.get(created.sessionId)?.controller).toMatchObject({ label: 'Desktop A', systemPromptAppend: 'report back', permissionMode: 'acceptEdits' })

    // Without the lease the controller cannot drive the session.
    await expect(client.rpc('session.send', { sessionId: created.sessionId, text: 'hi', leaseId: 'x', generation: '1' })).rejects.toThrow()
    const lease = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId })
    await client.rpc('session.send', { sessionId: created.sessionId, text: 'do the task', clientMessageId: 'm1', leaseId: lease.leaseId, generation: lease.generation })
    expect(live.sent[0]).toMatchObject({ content: 'do the task', clientMessageId: 'm1' })

    const { events } = await client.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: '0' })
    const types = events.map((e) => e.eventType)
    expect(types).toEqual(['session.created', 'session.user_message', 'session.agent_event', 'session.agent_event'])
    expect(events[1].payload).toMatchObject({ blockId: 'm1', text: 'do the task' })
    expect((events[2].payload as { event: Record<string, unknown> }).event).not.toHaveProperty('projectPath')

    await expect(client.rpc('session.fork', { sessionId: created.sessionId })).rejects.toMatchObject({ code: 'not_found' })
    await expect(client.rpc('terminal.create', { cwd: projectDir })).rejects.toMatchObject({ code: 'not_found' })
    await expect(client.rpc('harness.enable', { harnessId: 'codex' })).rejects.toMatchObject({ code: 'not_found' })

    // Restart B (on a fresh port: fetch would reuse the closed keep-alive socket): the cursor continues from the durable log.
    manager.disconnectAll()
    await stopDesktopNode(host)
    hosts.splice(0)
    host = await start(port + 1)
    hosts.push(host)
    const reconnected = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(tempDir('superone-desktop-a2-')) })
    managers.push(reconnected)
    const again = host.mintPairingToken()
    const second = await reconnected.pairAndConnect({ baseUrl: again.url, pairingToken: again.pairingToken, label: 'Desktop A', channel: again.channel })
    const after = await reconnected.getClient(second.connectionId)!.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: events[1].sequence })
    expect(after.events.map((e) => e.sequence)).toEqual(events.slice(2).map((e) => e.sequence))
    const snapshot = await reconnected.getClient(second.connectionId)!.rpc<{ snapshotSequence: string }>('session.snapshot')
    expect(snapshot.snapshotSequence).toBe(events.at(-1)!.sequence)
  })
})

describe('DesktopNodeHost collaboration children', () => {
  it('cuts a worktree for a remote child and carries its mailbox tools to the controller as Host Actions', async () => {
    const { host, sessions, store, projectDir, connectionId, client } = await pairedDesktops()

    const described = await client.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(described.capabilities).toMatchObject({ hostActionV1: true })
    expect(described.capabilities.methods).toEqual(expect.arrayContaining(['git.fetch', 'git.worktreeActivate']))
    // Only fetching and worktree creation of the git family are served.
    await expect(client.rpc('git.status', { projectId: 'p1' })).rejects.toMatchObject({ code: 'not_found' })
    // Pushed work B's checkout has not seen yet: the fetch makes it the base.
    const origin = tempDir('superone-origin-')
    execFileSync('git', ['init', '-q', '--bare', origin])
    execFileSync('git', ['-C', projectDir, 'remote', 'set-url', 'origin', origin])
    execFileSync('git', ['-C', projectDir, 'push', '-q', origin, 'HEAD:refs/heads/main'])
    execFileSync('git', ['-C', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
    const pusher = join(tempDir('superone-pusher-'), 'clone')
    execFileSync('git', ['clone', '-q', origin, pusher])
    execFileSync('git', ['-C', pusher, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'pushed from A'])
    execFileSync('git', ['-C', pusher, 'push', '-q', 'origin', 'HEAD:main'])
    await client.rpc('git.fetch', { projectId: 'p1', remote: 'origin' })
    const worktree = await client.rpc<{ path: string }>('git.worktreeActivate', {
      projectId: 'p1', baseBranch: 'origin/HEAD', mode: 'branch', branchName: 'superone/builder-1',
    })
    expect(execFileSync('git', ['-C', worktree.path, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('pushed from A')
    expect(execFileSync('git', ['-C', worktree.path, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe('superone/builder-1')
    // A cwd outside the project and its served worktrees stays refused.
    await expect(client.rpc('session.create', { projectId: 'p1', harnessId: 'claude', cwd: tempDir('elsewhere-') }))
      .rejects.toMatchObject({ code: 'invalid_argument' })

    const created = await client.rpc<{ sessionId: string; externalParent?: { sessionId: string } }>('session.create', {
      projectId: 'p1', harnessId: 'claude', title: 'Builder - Implementer', cwd: worktree.path,
      systemPromptAppend: 'child of parent-a', externalParent: { sessionId: 'parent-a' },
    })
    expect(created.externalParent).toEqual({ sessionId: 'parent-a' })
    expect(store.rows.get(created.sessionId)?.controller.externalParent).toEqual({ sessionId: 'parent-a' })
    expect(host.sessions.externalParentOf(created.sessionId)).toEqual({ sessionId: 'parent-a' })
    expect(sessions.live.get(created.sessionId)!.cwd).toBe(worktree.path)
    void projectDir

    // A's persistent consumer runs whatever the child asks of the controller.
    const executed: Array<{ toolName: string; sessionId: string; args: unknown }> = []
    const consumer = new RemoteHostActionConsumer({
      connectionId,
      client,
      pollWaitMs: 200,
      executor: async (claimed) => {
        executed.push({ toolName: claimed.toolName, sessionId: claimed.sessionId, args: claimed.args })
        return { outcome: 'succeeded', result: { content: [{ type: 'text', text: '{"status":"sent"}' }] } }
      },
    })
    consumer.start()
    try {
      const live = sessions.live.get(created.sessionId)!
      live.status = 'streaming'
      const terminal = await host.sessions.requestHostAction({
        sessionId: created.sessionId, toolName: 'session_collab_send', args: { content: 'Pushed the branch' },
      })
      expect(terminal).toMatchObject({ state: 'succeeded', result: { content: [{ type: 'text', text: '{"status":"sent"}' }] } })
      expect(executed).toEqual([{ toolName: 'session_collab_send', sessionId: created.sessionId, args: { content: 'Pushed the branch' } }])

      // An action outlives no turn: the end of the run cancels what is still pending.
      consumer.stop('test')
      await consumer.waitUntilStopped()
      const pending = host.sessions.requestHostAction({ sessionId: created.sessionId, toolName: 'session_collab_retrieve', args: {} })
      live.status = 'idle'
      const lease = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId })
      await client.rpc('session.send', { sessionId: created.sessionId, text: 'wake', leaseId: lease.leaseId, generation: lease.generation })
      await expect(pending).resolves.toMatchObject({ state: 'cancelled' })
    } finally {
      consumer.stop('test')
      await consumer.waitUntilStopped()
    }
  })
})

describe('DesktopNodeHost agent catalog', () => {
  it('lists the agents it can launch and creates a child on the model and key picked from them', async () => {
    const { sessions, store, client } = await pairedDesktops()
    expect(await client.rpc('collaboration.listProfiles')).toEqual(AGENT_PROFILES)
    // The mailbox stays with the controller: only the catalog of the family is served.
    await expect(client.rpc('collaboration.send', { sessionId: 's', content: 'x' })).rejects.toMatchObject({ code: 'not_found' })

    const created = await client.rpc<{ sessionId: string; model: string | null; apiProviderId: string | null }>('session.create', {
      projectId: 'p1', harnessId: 'claude', options: { model: 'claude-opus', effort: 'medium', apiProviderId: 'cred-b' },
    })
    const live = sessions.live.get(created.sessionId)!
    expect(live.apiProviderId).toBe('cred-b')
    expect(store.rows.get(created.sessionId)?.controller).toMatchObject({ model: 'claude-opus', effort: 'medium', apiProviderId: 'cred-b' })
    expect(await client.rpc('session.get', { sessionId: created.sessionId })).toMatchObject({ model: 'claude-opus', apiProviderId: 'cred-b' })

    const lease = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId })
    await client.rpc('session.send', { sessionId: created.sessionId, text: 'go', leaseId: lease.leaseId, generation: lease.generation })
    expect(live.sent[0]).toMatchObject({ content: 'go', model: 'claude-opus', effort: 'medium' })
  })
})

describe('DesktopNodeHost visibility', () => {
  it('records every session of the desktop but shows a controller only the ones it started', async () => {
    const { sessions, client, projectDir } = await pairedDesktops()
    const created = await client.rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude' })
    // A session this desktop's user runs: recorded, and private to the desktop.
    const own = sessions.createSession({ id: 'own-session', projectPath: projectDir }) as unknown as FakeSession
    own.emitHostEvent({ type: 'status_change', status: 'streaming' } as AgentEvent)
    sessions.live.get(created.sessionId)!.emitHostEvent({ type: 'status_change', status: 'streaming' } as AgentEvent)
    const { events } = await client.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: '0' })
    expect(new Set(events.map((e) => e.aggregateId))).toEqual(new Set([created.sessionId]))
  })
})

describe('DesktopNodeHost lifecycle and prompts', () => {
  it('answers in-flight Host Actions when the host stops', async () => {
    const { host, sessions, client } = await pairedDesktops()
    const created = await client.rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude' })
    sessions.live.get(created.sessionId)!.status = 'streaming'
    const pending = host.sessions.requestHostAction({ sessionId: created.sessionId, toolName: 'session_collab_retrieve', args: {} })

    // Turning remote access off (or changing its port) stops the listener; no controller can answer.
    await host.stop()
    await expect(pending).resolves.toMatchObject({ state: 'cancelled' })

    // Quitting closes the domain, which takes no more.
    hosts.splice(hosts.indexOf(host), 1)
    host.domain.close()
    await expect(host.sessions.requestHostAction({ sessionId: created.sessionId, toolName: 'session_collab_send', args: {} }))
      .rejects.toMatchObject({ code: 'failed_precondition' })
  })

  it('reports the live prompt of a session as its pending interaction', async () => {
    const { sessions, client } = await pairedDesktops()
    const created = await client.rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude' })
    const live = sessions.live.get(created.sessionId)!
    live.status = 'streaming'
    const read = async () => (await client.rpc<{ pendingInteraction: Record<string, unknown> | null }>('session.get', { sessionId: created.sessionId })).pendingInteraction

    expect(await read()).toBeNull()

    live.pending = [{ type: 'permission_request', request: { requestId: 'perm-1', toolName: 'Bash', toolUseId: 'tu-1', input: { command: 'ls' }, allowAlwaysAllow: true } } as AgentEvent]
    const permission = await read()
    expect(permission).toMatchObject({ interactionId: 'perm-1', kind: 'permission', toolName: 'Bash', toolUseId: 'tu-1', input: { command: 'ls' }, allowAlwaysAllow: true })
    // Stable across reads, so a controller can tell a prompt it already shows.
    expect((await read())?.createdAt).toBe(permission?.createdAt)

    live.pending = [{ type: 'ask_user_question', request: { requestId: 'q-1', questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A' }], multiSelect: false }] } } as AgentEvent]
    expect(await read()).toMatchObject({ interactionId: 'q-1', kind: 'question', input: { questions: [{ question: 'Which?' }] } })

    live.pending = [{ type: 'plan_approval', request: { requestId: 'plan-1', planContent: 'Do it', planFilePath: '/tmp/plan.md', allowedPrompts: [] } } as AgentEvent]
    expect(await read()).toMatchObject({ interactionId: 'plan-1', kind: 'plan', input: { plan: 'Do it' } })

    // A reconnecting controller restores the prompt from the snapshot.
    const snapshot = await client.rpc<{ sessions: Array<{ sessionId: string; pendingInteraction: unknown }> }>('session.snapshot')
    expect(snapshot.sessions.find((s) => s.sessionId === created.sessionId)?.pendingInteraction).toMatchObject({ interactionId: 'plan-1', kind: 'plan' })
  })
})

describe('DesktopNodeHost takeback', () => {
  it('lets this desktop take a session back and the controller reconnect only on purpose', async () => {
    const { host, sessions, client } = await pairedDesktops()
    const created = await client.rpc<{ sessionId: string; controllerClientSessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude' })
    const live = sessions.live.get(created.sessionId)!
    const lease = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId })
    const { snapshotSequence } = await client.rpc<{ snapshotSequence: string }>('session.snapshot')

    // Disconnect here: this desktop drives it, the controller's lease is gone.
    host.sessions.releaseControl(created.sessionId)
    expect(live.owner).toEqual({ kind: 'local' })
    await expect(client.rpc('session.send', { sessionId: created.sessionId, text: 'hi', leaseId: lease.leaseId, generation: lease.generation }))
      .rejects.toMatchObject({ code: 'failed_precondition', details: { reason: 'control_released' } })
    await expect(client.rpc('session.renewControl', { leaseId: lease.leaseId, generation: lease.generation })).rejects.toMatchObject({ code: 'lease_stale' })
    // An ordinary acquire (the controller's automatic one before a send) does not take it back.
    await expect(client.rpc('session.acquireControl', { sessionId: created.sessionId }))
      .rejects.toMatchObject({ details: { reason: 'control_released' } })
    expect(await client.rpc('session.get', { sessionId: created.sessionId })).toMatchObject({ controlReleased: true })

    // The controller learns it from the event log, as this desktop's UI does from the session.
    const { events } = await client.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: snapshotSequence })
    expect(events.map((e) => (e.payload as { event?: AgentEvent }).event)).toContainEqual({ type: 'remote_control_changed', released: true })

    // Reconnect: an explicit reclaim drives it again, and again, like a phone.
    const reclaimed = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId, reclaim: true })
    expect(Number(reclaimed.generation)).toBeGreaterThan(Number(lease.generation))
    expect(live.owner).toEqual({ kind: 'remote', deviceId: nodeControllerDeviceId(created.controllerClientSessionId) })
    await client.rpc('session.send', { sessionId: created.sessionId, text: 'go on', leaseId: reclaimed.leaseId, generation: reclaimed.generation })
    expect(live.sent.at(-1)).toMatchObject({ content: 'go on' })
    expect(await client.rpc('session.get', { sessionId: created.sessionId })).not.toHaveProperty('controlReleased')

    host.sessions.releaseControl(created.sessionId)
    await client.rpc('session.acquireControl', { sessionId: created.sessionId, reclaim: true })
    expect(live.owner).toMatchObject({ kind: 'remote' })
  })
})

describe('DesktopNodeHost launch tasks', () => {
  it("shows a controller agent's launch task as a task from that desktop, here and on the controller", async () => {
    const { sessions, client } = await pairedDesktops()
    const created = await client.rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude' })
    const lease = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId })
    const { snapshotSequence } = await client.rpc<{ snapshotSequence: string }>('session.snapshot')
    await client.rpc('session.send', {
      sessionId: created.sessionId, text: 'Fix the flaky upload test', clientMessageId: 'task-1', leaseId: lease.leaseId, generation: lease.generation,
      options: { echoUserMessage: true, collaboration: { kind: 'initial_task' } },
    })
    expect(sessions.live.get(created.sessionId)!.sent[0]).toMatchObject({
      source: 'collaboration',
      collaboration: { kind: 'initial_task', direction: 'inbound', fromSessionTitle: 'Desktop A' },
    })

    const { events } = await client.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: snapshotSequence })
    const mapped = mapNodeSessionEvents(events, { sessionId: created.sessionId, projectPath: 'remote:b:/p', providerId: 'claude' })
    const task = mapped.find((e) => e.type === 'user_message_appended')
    expect(task && 'message' in task ? task.message.metadata : null).toEqual({
      source: 'collaboration',
      collaboration: { kind: 'initial_task', direction: 'inbound', fromSessionTitle: 'Desktop A' },
    })
  })
})
