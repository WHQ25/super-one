import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decodeNodePairingCode,
  encodeNodePairingCode,
  nodePairingEndpointProfiles,
  type NodePairingCode,
} from '@superone/shared/environment'
import { startTestRelay } from '@superone/runtime/server/test-relay'

const electron = vi.hoisted(() => ({ store: new Map<string, string>(), userData: '' }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `r-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => electron.store.get(buf.toString())!,
  },
  app: { getPath: () => electron.userData },
}))
vi.mock('../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { EnvironmentHost, resetEnvironmentHostForTests } from './environment-host'
import { startTestDesktopNode } from '../node-host/node-host-test-fixtures'

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

/** The code B shows, without its LAN hint: A and B share no network and no tailnet. */
function relayOnly(code: NodePairingCode): NodePairingCode {
  const { lan: _lan, tailscaleHost: _ts, ...rest } = code
  return rest
}

describe('EnvironmentHost with a relay-only desktop node', () => {
  it('pairs, reconnects after a drop, fails over and re-pairs through the relay; reports an offline node fast', async () => {
    const relay = await startTestRelay()
    cleanup.push(() => relay.close())
    const { host: b } = await startTestDesktopNode({
      userDataDir: tempDir('superone-ehr-b-'),
      projectDir: tempDir('superone-ehr-project-'),
      listen: { bindPort: 0, relayUrl: relay.url },
    })
    let bRunning = true
    cleanup.push(() => (bRunning ? b.stop() : undefined))
    await vi.waitFor(() => expect(b.relayConnected).toBe(true))

    electron.userData = tempDir('superone-ehr-a-')
    const a = new EnvironmentHost(electron.userData, { discoverLan: async () => [] })
    cleanup.push(() => a.dispose())

    const code = relayOnly(decodeNodePairingCode(encodeNodePairingCode(b.mintPairingToken()), Date.now()))
    const { connectionId, descriptor } = await a.pairRemote({
      environmentId: code.environmentId,
      endpointProfiles: nodePairingEndpointProfiles(code),
      pairingToken: code.pairingToken,
      label: 'Desktop B',
      channel: code.channel,
    })
    expect(descriptor.environmentId).toBe(b.identity.environmentId)
    const pathOf = async () => (await a.listEnvironments({ includeDescriptors: false })).find((i) => i.connectionId === connectionId)?.activePath
    expect(await pathOf()).toBe('relay')
    const rpc = () => a.connections.getClient(connectionId)!.rpc<{ ok: boolean }>('environment.health')

    // The relay drops A's slot (network change): the supervisor reconnects through the relay.
    relay.dropClients()
    await vi.waitFor(async () => {
      expect(a.connections.isConnected(connectionId)).toBe(true)
      await expect(rpc()).resolves.toMatchObject({ ok: true })
    }, { timeout: 10_000, interval: 100 })

    // Explicit failover picks the relay; there is no HTTP endpoint to probe.
    await expect(a.connectWithFailover(connectionId)).resolves.toMatchObject({ endpointId: 'relay', environmentId: b.identity.environmentId })
    expect(await pathOf()).toBe('relay')

    // Re-pair from a fresh code, still through the relay alone.
    const fresh = relayOnly(decodeNodePairingCode(encodeNodePairingCode(b.mintPairingToken()), Date.now()))
    const repaired = await a.repairPairing({
      connectionId,
      pairingToken: fresh.pairingToken,
      channel: fresh.channel,
      endpointProfiles: nodePairingEndpointProfiles(fresh),
    })
    expect(repaired.environmentId).toBe(b.identity.environmentId)
    await expect(rpc()).resolves.toMatchObject({ ok: true })
    expect(await pathOf()).toBe('relay')

    // B goes away: failover reports it offline from the relay's presence, well under the 10 s handshake timeout.
    await b.stop()
    bRunning = false
    await vi.waitFor(() => expect(relay.hasDesktop(fresh.relay!.room)).toBe(false))
    const started = Date.now()
    await expect(a.connectWithFailover(connectionId)).rejects.toThrow(/offline/)
    expect(Date.now() - started).toBeLessThan(3_000)
  })
})
