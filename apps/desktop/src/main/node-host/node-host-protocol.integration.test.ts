import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  decodeNodePairingCode,
  encodeNodePairingCode,
  nodePairingEndpointProfiles,
  type EnvironmentEventEnvelope,
  type NodePairingCode,
} from '@superone/shared/environment'
import { startTestRelay } from '@superone/runtime/server/test-relay'
import scenarios from '../stream/fixtures/emitted.generated.json'
import baseline from '../stream/fixtures/wire-baseline.json'

const electron = vi.hoisted(() => ({ store: new Map<string, string>(), userData: '' }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `p-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => electron.store.get(buf.toString())!,
  },
  app: { getPath: () => electron.userData },
}))
vi.mock('../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { EnvironmentHost, resetEnvironmentHostForTests } from '../environment/environment-host'
import { lanPath, startTestDesktopNode } from './node-host-test-fixtures'

/**
 * Desktop A following a session on desktop B through the unified protocol:
 * what the relay carries for a recorded turn against the phone link before
 * it (`stream/fixtures/wire-baseline.json`), and a tier change mid-turn.
 */

type Recording = { recording: string; events: AgentEvent[] }
type Wire = { frames: number; bytes: number }
/** As `stream/wire-baseline.test.ts` spaces recorded events. */
const EVENT_SPACING_MS = 10

const cleanup: Array<() => unknown> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
  resetEnvironmentHostForTests()
  electron.store.clear()
})

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** B on the relay, and A paired with it from B's code: relay alone, or with a LAN path to B that starts down. */
async function pairedOverRelay(opts: { lan?: boolean } = {}) {
  const relay = await startTestRelay()
  cleanup.push(() => relay.close())
  const { host: b, sessions, close: closeB } = await startTestDesktopNode({
    userDataDir: tempDir('superone-proto-b-'),
    projectDir: tempDir('superone-proto-project-'),
    listen: { bindPort: 0, relayUrl: relay.url },
  })
  cleanup.push(closeB)
  await vi.waitFor(() => expect(b.relayConnected).toBe(true))

  electron.userData = tempDir('superone-proto-a-')
  const a = new EnvironmentHost(electron.userData, { discoverLan: async () => [] })
  cleanup.push(() => a.dispose())
  const lan = opts.lan ? await lanPath(b.port) : null
  if (lan) cleanup.push(lan.cut)
  const { lan: _lan, tailscaleHost: _ts, ...relayOnly } = decodeNodePairingCode(encodeNodePairingCode(b.mintPairingToken()), Date.now())
  const code: NodePairingCode = lan ? { ...relayOnly, lan: { host: '127.0.0.1', port: Number(new URL(lan.url).port) } } : relayOnly
  const { connectionId } = await a.pairRemote({
    environmentId: code.environmentId,
    endpointProfiles: nodePairingEndpointProfiles(code),
    pairingToken: code.pairingToken,
    label: 'Desktop B',
    channel: code.channel,
  })
  const client = a.connections.getClient(connectionId)!
  const created = await client.rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude', title: 'turn' })
  const session = sessions.live.get(created.sessionId)!
  const emit = (event: AgentEvent) => session.emitHostEvent({ ...event, sessionId: created.sessionId, projectPath: '/b/project' } as AgentEvent)
  return { relay, a, lan, connectionId, environmentId: code.environmentId, sessionId: created.sessionId, emit }
}

/** Follow the session from its current version, collecting what arrives. */
async function follow(a: EnvironmentHost, connectionId: string, sessionId: string) {
  const received: EnvironmentEventEnvelope[] = []
  const resyncs: number[] = []
  const unfollow = await a.followSessionEvents(connectionId, sessionId, {
    event: (envelope) => received.push(envelope),
    end: () => {},
    resync: () => resyncs.push(received.length),
  }, async () => {
    const { events } = await a.connections.getClient(connectionId)!.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: '0' })
    return events.filter((e) => e.aggregateId === sessionId).at(-1)?.sessionVersion ?? 0
  })
  cleanup.push(unfollow)
  return { received, resyncs }
}

/** Waits until nothing more reaches A for a while. */
async function quiet(frames: string[], ms = 400): Promise<void> {
  let count = -1
  while (count !== frames.length) {
    count = frames.length
    await sleep(ms)
  }
}

describe('unified protocol between desktops', () => {
  it('follows a recorded turn over the relay at no more frames or bytes than the phone link did', async () => {
    const measured: Record<string, Wire> = {}
    for (const { recording, events } of scenarios as Recording[]) {
      const { relay, a, connectionId, sessionId, emit } = await pairedOverRelay()
      const { received } = await follow(a, connectionId, sessionId)
      // The chat opens the session as it follows it; over the relay that summarizes it.
      await expect(a.connections.getClient(connectionId)!.rpc('session.load', { sessionId })).resolves.toMatchObject({ summarized: true })
      await quiet(relay.fromDesktop)
      const mark = relay.fromDesktop.length
      // The baseline's pace: one event every 10 ms, on schedule however long each takes.
      const started = Date.now()
      for (const [index, event] of events.filter((e) => typeof e.type === 'string').entries()) {
        await sleep(Math.max(0, started + index * EVENT_SPACING_MS - Date.now()))
        emit(event)
      }
      await quiet(relay.fromDesktop)
      const frames = relay.fromDesktop.slice(mark)
      measured[recording] = { frames: frames.length, bytes: frames.reduce((sum, text) => sum + Buffer.byteLength(text), 0) }
      expect(received.length).toBeGreaterThan(0)
      while (cleanup.length) await cleanup.pop()!()
      resetEnvironmentHostForTests()
    }
    for (const [recording, wire] of Object.entries(measured)) {
      const phone = (baseline as Record<string, { live?: Wire }>)[recording].live!
      expect({ recording, frames: wire.frames <= phone.frames, bytes: wire.bytes <= phone.bytes, wire, phone })
        .toMatchObject({ recording, frames: true, bytes: true })
    }
  }, 120_000)

  it('keeps following a session across LAN and relay mid-turn, reading it again on each tier change', async () => {
    const { a, lan, connectionId, environmentId, sessionId, emit } = await pairedOverRelay({ lan: true })
    const tier = () => a.connections.getClient(connectionId)!.tier
    expect(tier()).toBe('relay')
    const { received, resyncs } = await follow(a, connectionId, sessionId)
    const say = async (text: string) => {
      const before = received.length
      emit({ type: 'user_message_appended', message: { id: text, role: 'user', status: 'complete', content: [{ type: 'text', text }], createdAt: new Date().toISOString(), providerId: 'claude' } } as unknown as AgentEvent)
      await vi.waitFor(() => expect(received.length).toBeGreaterThan(before), { timeout: 10_000, interval: 50 })
      return received.at(-1)!
    }

    await say('over the relay')
    expect(resyncs).toHaveLength(0)

    // A joins B's network: the connection moves to the LAN and the chat reads the session again.
    await lan!.up()
    await a.connections.checkRoute(environmentId)
    await vi.waitFor(() => expect(tier()).toBe('lan'), { timeout: 10_000, interval: 50 })
    await vi.waitFor(() => expect(resyncs).toHaveLength(1), { timeout: 10_000, interval: 50 })
    expect(JSON.stringify((await say('over the lan')).payload)).toContain('over the lan')

    // A leaves it mid-turn: back on the relay without a reload.
    await lan!.cut()
    await vi.waitFor(() => expect(tier()).toBe('relay'), { timeout: 10_000, interval: 50 })
    await vi.waitFor(() => expect(resyncs).toHaveLength(2), { timeout: 10_000, interval: 50 })
    expect(JSON.stringify((await say('back on the relay')).payload)).toContain('back on the relay')
  }, 60_000)
})
