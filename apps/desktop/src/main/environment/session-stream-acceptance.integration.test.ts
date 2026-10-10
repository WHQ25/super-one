/**
 * The pushed session stream end to end: a real CLI node runtime (WebSocket,
 * SQLite, pairing) and the desktop's own connection manager and gateway, with
 * a reader that opens a session at `session.load` and reduces the pushed
 * stream as the chat does.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyEventToSession, createDefaultChatCoreSession, createStreamingToolInputStore, defaultChatCorePorts, type ChatCoreSession } from '@superone/chat-core'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { EnvironmentGateway } from '@superone/shared/environment'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'

const electron = vi.hoisted(() => ({ store: new Map<string, string>() }))
/** The node a routed phone reaches through this desktop. */
const routed = vi.hoisted(() => ({ gateway: null as unknown, environmentId: '', connectionId: '' }))
vi.mock('./environment-host', () => ({
  getEnvironmentHost: () => ({
    listEnvironments: async () => [{ environmentId: routed.environmentId, connectionId: routed.connectionId, kind: 'remote' }],
    getGateway: () => routed.gateway,
  }),
}))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => { const id = `b-${electron.store.size}`; electron.store.set(id, s); return Buffer.from(id) },
    decryptString: (buf: Buffer) => { const v = electron.store.get(buf.toString()); if (v === undefined) throw new Error('missing'); return v },
  },
}))

import { startNodeRuntime, type NodeRuntime } from '../../../../../apps/cli/src/runtime'
import { createSimulatedTurnRunner } from '@superone/runtime/session'
import { NodeConnectionManager } from './node-connection-manager'
import { NodeCredentialStore } from './node-credential-store'
import { executeEnvironmentCommand, kickRoutedSessions, releaseEnvironmentDevice } from '../remote/environment-commands'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []
const managers: NodeConnectionManager[] = []
const aborts: AbortController[] = []

afterEach(async () => {
  await releaseEnvironmentDevice('phone-a')
  await releaseEnvironmentDevice('phone-b')
  for (const abort of aborts.splice(0)) abort.abort()
  for (const manager of managers.splice(0)) manager.disconnectAll()
  while (runtimes.length) await runtimes.pop()!.stop().catch(() => {})
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  electron.store.clear()
})

const tmp = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); dirs.push(dir); return dir }

async function bootNode(runner: Parameters<typeof createSimulatedTurnRunner>[0], nodeHome = tmp('stream-node-'), bindPort = 0) {
  const runtime = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort, turnRunner: createSimulatedTurnRunner(runner), simulatedHarness: true })
  runtimes.push(runtime)
  return runtime
}

async function pairDesktop(runtime: NodeRuntime, label: string) {
  const manager = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(tmp('stream-desktop-')) })
  managers.push(manager)
  const { connectionId, descriptor } = await manager.pairAndConnect({ baseUrl: runtime.server.url, pairingToken: runtime.auth.createPairingToken().token, label })
  return { manager, connectionId, environmentId: descriptor.environmentId, gateway: manager.getGateway(descriptor.environmentId)! as EnvironmentGateway }
}

async function newSession(gateway: EnvironmentGateway, environmentId: string) {
  const path = tmp('stream-project-')
  const project = await gateway.openProject!(path)
  const { sessionId } = await gateway.sessions.create({ project: { environmentId, projectId: project.projectId }, providerId: 'codex' })
  return { environmentId, sessionId, path: project.path }
}

/** Opens a session at its snapshot and keeps reducing its pushed stream, as the chat does. */
async function openReader(gateway: EnvironmentGateway, ref: { environmentId: string; sessionId: string }, beforeSubscribe?: () => Promise<void>) {
  const load = () => gateway.sessions.load!({ session: ref, limit: 200 })
  const loaded = await load()
  await beforeSubscribe?.()
  const ports = { ...defaultChatCorePorts, streaming: createStreamingToolInputStore() }
  const mapper = createNodeSessionEventMapper({ sessionId: ref.sessionId, projectPath: 'p', providerId: 'codex', skipUserMessage: false })
  const reader = {
    state: { ...createDefaultChatCoreSession(), ...loaded.state, messages: loaded.messages } as ChatCoreSession,
    barrier: loaded.cursor.version,
    resnapshots: 0,
    events: 0,
  }
  let reloading: Promise<void> | null = null
  const abort = new AbortController()
  aborts.push(abort)
  void (async () => {
    for await (const envelope of gateway.subscribeEvents({
      environmentId: ref.environmentId, afterSequence: loaded.cursor.sequence, epoch: loaded.cursor.epoch,
      versions: { [ref.sessionId]: loaded.cursor.version }, aggregateIds: [ref.sessionId], aggregateTypes: ['session'], signal: abort.signal,
      onResnapshot: () => {
        reader.resnapshots++
        reloading = load().then((fresh) => {
          reader.state = { ...createDefaultChatCoreSession(), ...fresh.state, messages: fresh.messages } as ChatCoreSession
          reader.barrier = fresh.cursor.version
        })
      },
    })) {
      if (reloading) { await reloading; reloading = null }
      if ((envelope.sessionVersion ?? Infinity) <= reader.barrier) continue
      reader.events++
      for (const event of mapper.map(envelope)) reader.state = { ...reader.state, ...applyEventToSession(reader.state, event, ports) }
    }
  })().catch(() => {})
  return { reader, load }
}

/** What the chat shows of a transcript. */
const view = (messages: ChatMessage[]) => messages.map((m) => [m.role, m.status, m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')])

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  // A check that reads the node fails while it redials: not yet.
  while (!(await Promise.resolve().then(check).catch(() => false))) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

async function send(gateway: EnvironmentGateway, ref: { environmentId: string; sessionId: string }, text: string, lease?: { leaseId: string; generation: string }) {
  const control = lease ?? await gateway.sessions.acquireControl({ resource: ref, ttlMs: 60_000 })
  await gateway.sessions.send({ session: ref, leaseId: control.leaseId, generation: control.generation, text, clientMessageId: `u-${text}` })
  return control
}

describe('pushed session stream against a node', () => {
  it("shows another client's turn in an open idle session, without polling or a rehydrate", async () => {
    const runtime = await bootNode({ chunks: ['one ', 'two ', 'three'], delayMs: 20 })
    const watcher = await pairDesktop(runtime, 'watching desktop')
    const driver = await pairDesktop(runtime, 'driving desktop')
    const ref = await newSession(watcher.gateway, watcher.environmentId)
    const { reader, load } = await openReader(watcher.gateway, ref)

    await send(driver.gateway, ref, 'hi')
    await until(async () => (await load()).state.status === 'idle' && reader.state.messages.some((m) => m.role === 'assistant' && m.status === 'complete'))

    expect(view(reader.state.messages)).toEqual(view((await load()).messages))
    expect(view(reader.state.messages).at(-1)).toEqual(['assistant', 'complete', 'one two three'])
    expect(reader.resnapshots).toBe(0)
  })

  it('resumes across a dropped connection mid-turn and ends with the complete ordered transcript', async () => {
    const runtime = await bootNode({ chunks: Array.from({ length: 12 }, (_, i) => `c${i} `), delayMs: 60 })
    const desktop = await pairDesktop(runtime, 'desktop')
    const ref = await newSession(desktop.gateway, desktop.environmentId)
    const { reader, load } = await openReader(desktop.gateway, ref)

    await send(desktop.gateway, ref, 'go')
    await until(() => reader.state.messages.some((m) => m.role === 'assistant' && m.content.length > 0))
    // The socket drops as on a network loss; the supervisor redials.
    ;(desktop.manager.getClient(desktop.connectionId) as unknown as { ws: { terminate(): void } }).ws.terminate()

    await until(async () => (await load()).state.status === 'idle', 15_000)
    await until(() => reader.state.messages.at(-1)?.status === 'complete', 15_000)
    expect(view(reader.state.messages)).toEqual(view((await load()).messages))
    expect(view(reader.state.messages).at(-1)?.[2]).toBe(Array.from({ length: 12 }, (_, i) => `c${i} `).join(''))
  })

  it('resumes a reader whose missed events were committed away, through a snapshot', async () => {
    const runtime = await bootNode({ chunks: ['a ', 'b ', 'c'], delayMs: 20 })
    const desktop = await pairDesktop(runtime, 'desktop')
    const ref = await newSession(desktop.gateway, desktop.environmentId)
    // The reader read the session, then lost its connection for the whole turn.
    const { reader, load } = await openReader(desktop.gateway, ref, async () => {
      await send(desktop.gateway, ref, 'go')
      await until(async () => (await desktop.gateway.sessions.load!({ session: ref })).state.status === 'idle'
        && (await desktop.gateway.sessions.load!({ session: ref })).messages.some((m) => m.role === 'assistant' && m.status === 'complete'))
    })

    await until(() => reader.resnapshots > 0 && reader.state.messages.at(-1)?.status === 'complete')
    expect(view(reader.state.messages)).toEqual(view((await load()).messages))
  })

  it('keeps a routed phone whole across a dropped upstream, and holds the session for one phone at a time', async () => {
    const runtime = await bootNode({ chunks: Array.from({ length: 10 }, (_, i) => `p${i} `), delayMs: 40 })
    const desktop = await pairDesktop(runtime, 'desktop')
    Object.assign(routed, { gateway: desktop.gateway, environmentId: desktop.environmentId, connectionId: desktop.connectionId })
    const ref = await newSession(desktop.gateway, desktop.environmentId)
    const sent: AgentEvent[] = []
    const opened = await executeEnvironmentCommand(ref.environmentId, { type: 'subscribe_session', requestId: 'r', projectPath: ref.path, sessionId: ref.sessionId }, 'phone-a', async (event) => { sent.push(event) }) as { historyPage: { messages: ChatMessage[] } }
    await expect(executeEnvironmentCommand(ref.environmentId, { type: 'subscribe_session', requestId: 'r2', projectPath: ref.path, sessionId: ref.sessionId }, 'phone-b', async () => {}))
      .rejects.toMatchObject({ code: 'failed_precondition' })

    await executeEnvironmentCommand(ref.environmentId, { type: 'send_message', sessionId: ref.sessionId, projectPath: ref.path, content: 'go', clientMessageId: 'u-go' } as never, 'phone-a', async () => {})
    await until(() => sent.some((event) => event.type === 'content_delta'))
    ;(desktop.manager.getClient(desktop.connectionId) as unknown as { ws: { terminate(): void } }).ws.terminate()

    // The phone's own reducer over what it was sent.
    const phone = () => {
      const ports = { ...defaultChatCorePorts, streaming: createStreamingToolInputStore() }
      let state = { ...createDefaultChatCoreSession(), messages: opened.historyPage.messages } as ChatCoreSession
      for (const event of sent) state = { ...state, ...applyEventToSession(state, event, ports) }
      return state.messages.filter((m) => m.role === 'assistant')
    }
    const assistants = async () => (await desktop.gateway.sessions.load!({ session: ref, limit: 200 })).messages.filter((m) => m.role === 'assistant')
    await until(async () => (await assistants()).at(-1)?.status === 'complete' && phone().at(-1)?.status === 'complete', 15_000)
    expect(view(phone())).toEqual(view(await assistants()))
    expect(sent.some((event) => event.type === 'status_change' && event.status === 'error')).toBe(false)

    // The window's Disconnect hands the session to the next phone.
    await kickRoutedSessions(ref.sessionId)
    await expect(executeEnvironmentCommand(ref.environmentId, { type: 'subscribe_session', requestId: 'r3', projectPath: ref.path, sessionId: ref.sessionId }, 'phone-b', async () => {}))
      .resolves.toMatchObject({ ok: true })
  })

  it('after a node restart mid-turn reads the interruption and the cleared prompt, signalled by the new epoch', async () => {
    const nodeHome = tmp('stream-restart-')
    const first = await bootNode({ requestPermission: true }, nodeHome)
    const port = Number(new URL(first.server.url).port)
    const desktop = await pairDesktop(first, 'desktop')
    const ref = await newSession(desktop.gateway, desktop.environmentId)
    const { reader, load } = await openReader(desktop.gateway, ref)

    await send(desktop.gateway, ref, 'needs approval')
    await until(() => reader.state.pendingPermissions.length === 1)
    await first.stop()
    runtimes.splice(runtimes.indexOf(first), 1)
    await bootNode({ requestPermission: true }, nodeHome, port)

    await until(() => reader.resnapshots > 0, 20_000)
    await until(() => reader.state.status === 'idle' && reader.state.pendingPermissions.length === 0)
    const fresh = await load()
    expect(fresh.state).toMatchObject({ status: 'idle', pendingPermissions: [] })
    expect(view(reader.state.messages)).toEqual(view(fresh.messages))
    expect(reader.state.messages.some((m) => m.status === 'streaming')).toBe(false)
  })

  it('ends two phones and the window racing on a session with one holder', async () => {
    const runtime = await bootNode({})
    const desktop = await pairDesktop(runtime, 'desktop')
    const other = await pairDesktop(runtime, 'other desktop')
    const ref = await newSession(desktop.gateway, desktop.environmentId)
    const acquire = (gateway: EnvironmentGateway, input: { delegate?: string; yields?: boolean }) =>
      gateway.sessions.acquireControl({ resource: ref, ttlMs: 60_000, ...input }).then(() => 'held', (err: { code?: string }) => err.code ?? 'error')

    expect(await acquire(desktop.gateway, { yields: true })).toBe('held')
    const results = await Promise.all([acquire(desktop.gateway, { delegate: 'phone-a' }), acquire(desktop.gateway, { delegate: 'phone-b' })])
    expect(results.sort()).toEqual(['failed_precondition', 'held'])
    expect(await acquire(desktop.gateway, { yields: true })).toBe('failed_precondition')
    expect(await acquire(other.gateway, { yields: true })).toBe('failed_precondition')
  })
})
