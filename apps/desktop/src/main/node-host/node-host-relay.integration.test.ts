import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decodeNodePairingCode,
  encodeNodePairingCode,
  nodePairingEndpointProfiles,
  type EnvironmentEventEnvelope,
} from '@superone/shared/environment'
import { startTestRelay } from '@superone/runtime/server/test-relay'

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
import { NodeCredentialStore } from '../environment/node-credential-store'
import { NodeRouteResolver } from '../environment/node-route-resolver'
import { probeEndpointHealth } from '../environment/endpoint-probes'
import { lanPath, startSpoofedLanNode, startTestDesktopNode } from './node-host-test-fixtures'

const cleanup: Array<() => unknown> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
  electron.store.clear()
})

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

describe('desktop node over the relay', () => {
  it('keeps a working relay connection when the LAN answers /health but not the channel, and dials past it', async () => {
    const relay = await startTestRelay()
    cleanup.push(() => relay.close())
    const { host } = await startTestDesktopNode({
      userDataDir: tempDir('superone-spoof-b-'),
      projectDir: tempDir('superone-spoof-project-'),
      listen: { bindPort: 0, relayUrl: relay.url },
    })
    cleanup.push(() => host.stop())
    await vi.waitFor(() => expect(host.relayConnected).toBe(true))
    const spoof = await startSpoofedLanNode({ environmentId: host.identity.environmentId, nodePublicKeyFingerprint: host.identity.publicKeyFingerprint })
    cleanup.push(spoof.close)

    const code = decodeNodePairingCode(encodeNodePairingCode(host.mintPairingToken()), Date.now())
    const port = Number(new URL(spoof.url).port)
    const endpointProfiles = nodePairingEndpointProfiles({ ...code, lan: { host: '127.0.0.1', port } })
    let now = Date.now()
    const routes = new NodeRouteResolver(
      {
        discoverLan: async () => [],
        probe: async (baseUrl, target) => {
          const health = await probeEndpointHealth({ endpointId: 'p', kind: 'direct-wss', label: baseUrl, target: baseUrl }, { timeoutMs: 1_000 })
          return health.ok && health.environmentId === target.environmentId
        },
        openSshForward: async () => undefined,
      },
      () => now,
    )
    const manager = new NodeConnectionManager({
      credentialStore: new NodeCredentialStore(tempDir('superone-spoof-a-')),
      resolveReconnectRoute: (known) => routes.resolve(known),
      onRouteFailed: (known, route) => routes.markFailed(known, route),
      betterRoute: (known, current) => routes.betterRoute(known, current),
    })
    cleanup.push(() => manager.disconnectAll())

    // Pair over the relay (the LAN answer is not trusted for pairing either; see EnvironmentHost.pairRemote).
    const relayRoute = await routes.resolve({ environmentId: code.environmentId, endpointProfiles: endpointProfiles.filter((p) => p.kind === 'relay') })
    const { connectionId } = await manager.pairAndConnect({
      baseUrl: endpointProfiles[0].target, route: relayRoute, endpointProfiles, pairingToken: code.pairingToken, label: 'Desktop B', channel: code.channel,
    })
    const client = manager.getClient(connectionId)!
    const generation = manager.getSupervisor(connectionId)!.generation

    // Upgrade check: /health says LAN, the channel says no. The relay connection stays up, untouched.
    await manager.checkRoute(code.environmentId)
    expect(spoof.upgrades()).toBe(1)
    expect(manager.getActivePath(connectionId)).toBe('relay')
    expect(manager.getSupervisor(connectionId)!.generation).toBe(generation)
    await expect(client.rpc('environment.health')).resolves.toMatchObject({ ok: true })
    // The failed LAN is passed over for a while: the next check does not even try it.
    await manager.checkRoute(code.environmentId)
    expect(spoof.upgrades()).toBe(1)

    // A fresh dial with nothing remembered: the LAN wins on /health, fails the channel, and the same dial moves on to the relay.
    now += 10 * 60_000
    relay.dropClients()
    await vi.waitFor(() => {
      expect(manager.getSupervisor(connectionId)!.generation).toBeGreaterThan(generation)
      expect(manager.getActivePath(connectionId)).toBe('relay')
    }, { timeout: 10_000, interval: 50 })
    expect(spoof.upgrades()).toBeGreaterThanOrEqual(2)
    expect(manager.getSupervisor(connectionId)!.state).toBe('connected')
    await expect(client.rpc('environment.health')).resolves.toMatchObject({ ok: true })
  })


  it('pairs through the relay alone, moves to the LAN, falls back to the relay on LAN loss, and resumes events', async () => {
    const relay = await startTestRelay()
    cleanup.push(() => relay.close())
    const { host, sessions } = await startTestDesktopNode({
      userDataDir: tempDir('superone-relay-b-'),
      projectDir: tempDir('superone-relay-project-'),
      listen: { bindPort: 0, relayUrl: relay.url },
    })
    cleanup.push(() => host.stop())
    await vi.waitFor(() => expect(host.relayConnected).toBe(true))

    // The code B shows; its LAN hint is A's (cuttable) path to B, down for now.
    const lan = await lanPath(host.port)
    cleanup.push(lan.cut)
    const code = decodeNodePairingCode(encodeNodePairingCode(host.mintPairingToken()), Date.now())
    expect(code.relay).toEqual({ url: relay.url, room: expect.stringMatching(/^[0-9a-f]{32}$/) })
    const endpointProfiles = nodePairingEndpointProfiles({ ...code, lan: { host: '127.0.0.1', port: Number(new URL(lan.url).port) } })

    const routes = new NodeRouteResolver({
      discoverLan: async () => [],
      probe: async (baseUrl, target) => {
        const health = await probeEndpointHealth({ endpointId: 'p', kind: 'direct-wss', label: baseUrl, target: baseUrl }, { timeoutMs: 1_000 })
        return health.ok && health.environmentId === target.environmentId
      },
      openSshForward: async () => undefined,
    })
    const manager = new NodeConnectionManager({
      credentialStore: new NodeCredentialStore(tempDir('superone-relay-a-')),
      resolveReconnectRoute: (known) => routes.resolve(known),
      onRouteFailed: (known, route) => routes.markFailed(known, route),
      betterRoute: (known, current) => routes.betterRoute(known, current),
    })
    cleanup.push(() => manager.disconnectAll())

    const route = await routes.resolve({ environmentId: code.environmentId, endpointProfiles, preferredEndpointId: 'lan' })
    expect(route?.path).toBe('relay')
    const { connectionId, descriptor } = await manager.pairAndConnect({
      baseUrl: endpointProfiles[0].target, route, endpointProfiles, pairingToken: code.pairingToken, label: 'Desktop B', channel: code.channel,
    })
    expect(descriptor.environmentId).toBe(host.identity.environmentId)
    expect(manager.getActivePath(connectionId)).toBe('relay')

    const rpc = <T>(method: string, payload: unknown = {}) => manager.getClient(connectionId)!.rpc<T>(method, payload)
    const created = await rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude', title: 'child' })
    const lease = await rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId })
    const send = (text: string, id: string) =>
      rpc('session.send', { sessionId: created.sessionId, text, clientMessageId: id, leaseId: lease.leaseId, generation: lease.generation })
    const eventsAfter = (sequence: string) => rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: sequence })

    await send('over the relay', 'm1')
    const first = await eventsAfter('0')
    expect(first.events.map((e) => e.eventType)).toEqual(['session.created', 'session.user_message', 'session.agent_event', 'session.agent_event'])

    // A joins B's network: the next route check hands the connection to the LAN.
    await lan.up()
    await manager.checkRoute(code.environmentId)
    await vi.waitFor(() => expect(manager.getActivePath(connectionId)).toBe('lan'))
    await send('over the lan', 'm2')
    const second = await eventsAfter(first.events.at(-1)!.sequence)
    expect(second.events.map((e) => e.eventType)).toEqual(['session.user_message', 'session.agent_event', 'session.agent_event'])
    expect(second.events[0].payload).toMatchObject({ blockId: 'm2', text: 'over the lan' })

    // A leaves the network: the LAN socket dies and the supervisor re-dials over the relay.
    await lan.cut()
    await vi.waitFor(() => expect(manager.getActivePath(connectionId)).toBe('relay'), { timeout: 10_000, interval: 50 })
    await send('back on the relay', 'm3')
    const third = await eventsAfter(second.events.at(-1)!.sequence)
    expect(third.events.map((e) => e.eventType)).toEqual(['session.user_message', 'session.agent_event', 'session.agent_event'])
    expect(third.events[0].payload).toMatchObject({ blockId: 'm3' })
    expect(sessions.live.get(created.sessionId)!.sent.map((r) => r.content)).toEqual(['over the relay', 'over the lan', 'back on the relay'])

    // The relay saw only routing and ciphertext.
    const wire = relay.seen.join('\n')
    for (const secret of [code.channel.secretHex, code.pairingToken, 'session.send', 'over the relay', 'back on the relay']) {
      expect(wire).not.toContain(secret)
    }
  })
})
