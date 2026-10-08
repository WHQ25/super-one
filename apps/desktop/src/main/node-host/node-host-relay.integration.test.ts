import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecentFolder } from '@superone/shared/agent-types'
import {
  decodeNodePairingCode,
  encodeNodePairingCode,
  nodePairingEndpointProfiles,
  type EnvironmentEventEnvelope,
} from '@superone/shared/environment'
import { HarnessManager } from '@superone/runtime/harness'
import { openNodeDatabase } from '@superone/runtime/db'
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
import { createDesktopProjectsPort } from './desktop-projects-port'
import { AGENT_PROFILES, FakeSessionManager, memoryStore } from './node-host-test-fixtures'
import { DesktopNodeHost } from './node-host-server'

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
  it('pairs through the relay alone, runs RPC, then moves to the LAN and resumes events', async () => {
    const relay = await startTestRelay()
    cleanup.push(() => relay.close())

    // B: a desktop node with one project, listening on loopback and holding its relay room.
    const projectDir = tempDir('superone-relay-project-')
    execFileSync('git', ['init', '-q', projectDir])
    execFileSync('git', ['-C', projectDir, 'remote', 'add', 'origin', 'https://example.com/acme/app.git'])
    const folders: RecentFolder[] = [{ id: 'p1', path: projectDir, name: 'app', addedAt: '', lastOpened: new Date().toISOString() }]
    const projects = createDesktopProjectsPort({ list: () => folders, add: () => {} })
    const sessions = new FakeSessionManager()
    const harnesses = new HarnessManager(openNodeDatabase(':memory:'))
    harnesses.enableSimulatedOverlay()
    const host = await DesktopNodeHost.start(
      {
        userDataDir: tempDir('superone-relay-b-'), label: 'Desktop B', appVersion: '0.0.0-test', sessions,
        store: memoryStore(() => projects.list()), projects, harnesses,
        listAgentProfiles: () => AGENT_PROFILES,
        hooks: {
          probeHarnessReadiness: () => ({ ok: true }) as never,
          assertSessionHarnessRuntimeReady: () => ({ ok: true, reason: 'test' }),
        },
      },
      { bindPort: 0, relayUrl: relay.url },
    )
    cleanup.push(() => host.stop())
    await vi.waitFor(() => expect(host.relayConnected).toBe(true))

    // The code B shows: LAN hint (unreachable from A for now) and the relay room.
    const code = decodeNodePairingCode(encodeNodePairingCode(host.mintPairingToken()), Date.now())
    expect(code.relay).toEqual({ url: relay.url, room: expect.stringMatching(/^[0-9a-f]{32}$/) })
    const endpointProfiles = nodePairingEndpointProfiles(code)

    // A: not on B's network until `onLan` flips.
    let onLan = false
    const routes = new NodeRouteResolver({
      discoverLan: async () => [],
      probe: async (baseUrl, target) => {
        if (!onLan) return false
        const health = await probeEndpointHealth({ endpointId: 'p', kind: 'direct-wss', label: baseUrl, target: baseUrl })
        return health.ok && health.environmentId === target.environmentId
      },
      openSshForward: async () => undefined,
    })
    const manager = new NodeConnectionManager({
      credentialStore: new NodeCredentialStore(tempDir('superone-relay-a-')),
      resolveReconnectRoute: (known) => routes.resolve(known),
      betterRouteAvailable: (known, current) => routes.betterThan(known, current),
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
    await rpc('session.send', { sessionId: created.sessionId, text: 'over the relay', clientMessageId: 'm1', leaseId: lease.leaseId, generation: lease.generation })
    const first = await rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: '0' })
    expect(first.events.map((e) => e.eventType)).toEqual(['session.created', 'session.user_message', 'session.agent_event', 'session.agent_event'])

    // A joins B's network: the next route check hands the connection to the LAN.
    onLan = true
    await manager.checkRoute(code.environmentId)
    await vi.waitFor(() => expect(manager.getActivePath(connectionId)).toBe('lan'))

    // The session and lease carry over; the event cursor resumes after what A already has.
    await rpc('session.send', { sessionId: created.sessionId, text: 'over the lan', clientMessageId: 'm2', leaseId: lease.leaseId, generation: lease.generation })
    const resumed = await rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: first.events.at(-1)!.sequence })
    expect(resumed.events.map((e) => e.eventType)).toEqual(['session.user_message', 'session.agent_event', 'session.agent_event'])
    expect(resumed.events[0].payload).toMatchObject({ blockId: 'm2', text: 'over the lan' })
    expect(sessions.live.get(created.sessionId)!.sent.map((r) => r.content)).toEqual(['over the relay', 'over the lan'])

    // The relay saw only routing and ciphertext.
    const wire = relay.seen.join('\n')
    for (const secret of [code.channel.secretHex, code.pairingToken, 'session.send', 'over the relay']) {
      expect(wire).not.toContain(secret)
    }
  })
})
