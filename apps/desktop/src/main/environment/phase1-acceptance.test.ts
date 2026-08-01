/**
 * Phase 1 design acceptance tests — drive real apps/cli + desktop environment code.
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  available: true,
  store: new Map<string, string>(),
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => electron.available,
    encryptString: (s: string) => {
      const id = `e-${electron.store.size}`
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

import { startNodeRuntime, type NodeRuntime } from '../../../../../apps/cli/src/runtime'
import { regenerateIdentity } from '../../../../../apps/cli/src/identity'
import { NodeConnectionManager } from './node-connection-manager'
import { NodeCredentialStore } from './node-credential-store'
import { generateDeviceKeyPair, mintWsTicket, pairWithNode, refreshNodeAccess } from './node-auth-client'
import { NodeRpcClient } from './node-rpc-client'
import { signWithDeviceKey } from './node-auth-client'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop().catch(() => {})
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  electron.store.clear()
  electron.available = true
})

function temp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

async function bootNode(label = 'p1'): Promise<NodeRuntime> {
  const nodeHome = temp('superone-p1-node-')
  const port = 22000 + Math.floor(Math.random() * 10000)
  const rt = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    bindPort: port,
    label, simulatedHarness: true })
  runtimes.push(rt)
  return rt
}

describe('Phase 1 acceptance', () => {
  it('pairs, runs terminal with snapshot recovery after client reconnect, survives node client close', async () => {
    const runtime = await bootNode()
    const desktopData = temp('superone-p1-desk-')
    const store = new NodeCredentialStore(desktopData)
    const manager = new NodeConnectionManager({ credentialStore: store })

    const pair = runtime.auth.createPairingToken()
    const { connectionId, descriptor } = await manager.pairAndConnect({
      baseUrl: runtime.server.url,
      pairingToken: pair.token,
      label: 'linux-box',
    })

    const health = await fetch(`${runtime.server.url}/health`)
    const healthBody = (await health.json()) as { ok: boolean; environmentId: string }
    expect(healthBody.ok).toBe(true)
    expect(healthBody.environmentId).toBe(descriptor.environmentId)

    const gateway = manager.getGateway(descriptor.environmentId)!
    const created = await gateway.terminals.create({ cwd: runtime.config.nodeHome, title: 't' })
    const termLease = await gateway.terminals.acquireControl({
      resource: { environmentId: descriptor.environmentId, terminalId: created.terminalId },
      ttlMs: 60_000,
    })
    await gateway.terminals.write({
      terminal: { environmentId: descriptor.environmentId, terminalId: created.terminalId },
      data: 'echo PHASE1_MARKER\n',
      leaseId: termLease.leaseId,
      generation: termLease.generation,
    })
    await new Promise((r) => setTimeout(r, 250))
    const snap1 = await gateway.terminals.attach({
      environmentId: descriptor.environmentId,
      terminalId: created.terminalId,
    })
    expect(typeof snap1.snapshot).toBe('string')

    // Disconnect client (tunnel/desktop close) — node keeps running.
    manager.disconnect(connectionId)
    const stillUp = await fetch(`${runtime.server.url}/health`)
    expect(stillUp.ok).toBe(true)

    // Reconnect after "desktop restart" using stored credentials
    const store2 = new NodeCredentialStore(desktopData)
    const manager2 = new NodeConnectionManager({ credentialStore: store2 })
    expect(store2.get(connectionId)?.refreshToken).toBeTruthy()
    await manager2.connectExisting(connectionId)
    const gateway2 = manager2.getGateway(descriptor.environmentId)!
    const snap2 = await gateway2.terminals.attach({
      environmentId: descriptor.environmentId,
      terminalId: created.terminalId,
    })
    // Terminal still alive on node; snapshot/sequence recoverable
    expect(snap2.sequence).toBeDefined()
    expect(Number(snap2.sequence)).toBeGreaterThanOrEqual(Number(snap1.sequence))

    const termLease2 = await gateway2.terminals.acquireControl({
      resource: { environmentId: descriptor.environmentId, terminalId: created.terminalId },
      ttlMs: 60_000,
    })
    await gateway2.terminals.kill(
      { environmentId: descriptor.environmentId, terminalId: created.terminalId },
      { leaseId: termLease2.leaseId, generation: termLease2.generation },
    )
    manager2.disconnectAll()
  })

  it('refuses plaintext long-lived credential persistence when secure storage is unavailable', () => {
    electron.available = false
    const dir = temp('superone-p1-plain-')
    const store = new NodeCredentialStore(dir)
    const result = store.save({
      connectionId: 'c',
      environmentId: 'e',
      nodePublicKeyFingerprint: 'fp',
      clientSessionId: 's',
      devicePrivateKeyPem: 'SECRET_PRIV',
      devicePublicKeyPem: 'pub',
      refreshToken: 'SECRET_REFRESH',
      baseUrl: 'http://127.0.0.1:1',
      label: 'x',
      updatedAt: Date.now(),
    })
    expect(result).toEqual({ ok: true, persisted: false, reason: 'secure_storage_unavailable' })
    const credPath = join(dir, 'node-credentials', 'credentials.json')
    expect(existsSync(credPath)).toBe(false)
  })

  it('when secure storage works, disk never contains raw refresh or device private key', () => {
    electron.available = true
    const dir = temp('superone-p1-enc-')
    const store = new NodeCredentialStore(dir)
    store.save({
      connectionId: 'c',
      environmentId: 'e',
      nodePublicKeyFingerprint: 'fp',
      clientSessionId: 's',
      devicePrivateKeyPem: 'SECRET_PRIV_KEY_MATERIAL',
      devicePublicKeyPem: 'pub',
      refreshToken: 'SECRET_REFRESH_TOKEN_MATERIAL',
      baseUrl: 'http://127.0.0.1:1',
      label: 'x',
      updatedAt: Date.now(),
    })
    const raw = readFileSync(join(dir, 'node-credentials', 'credentials.json'), 'utf8')
    expect(raw).not.toContain('SECRET_PRIV_KEY_MATERIAL')
    expect(raw).not.toContain('SECRET_REFRESH_TOKEN_MATERIAL')
    expect(raw).toContain('enc:v1:')
  })

  it('revokes client session so further RPC fails', async () => {
    const runtime = await bootNode()
    const device = generateDeviceKeyPair()
    const pair = runtime.auth.createPairingToken()
    const paired = await pairWithNode({
      baseUrl: runtime.server.url,
      pairingToken: pair.token,
      devicePublicKeyPem: device.publicKeyPem,
    })
    const tokens = await refreshNodeAccess({
      baseUrl: runtime.server.url,
      refreshToken: paired.refreshToken,
      devicePrivateKeyPem: device.privateKeyPem,
      clientSessionId: paired.clientSessionId,
    })
    const ticket = await mintWsTicket({
      baseUrl: runtime.server.url,
      accessToken: tokens.accessToken,
    })
    const client = new NodeRpcClient({
      baseUrl: runtime.server.url,
      getWsTicket: async () => ticket,
      devicePrivateKeyPem: device.privateKeyPem,
      expectedEnvironmentId: paired.environmentId,
    })
    // Ticket is single-use — connect consumes it
    await client.connect()
    await client.getDescriptor()

    expect(runtime.auth.revokeClientSession(paired.clientSessionId)).toBe(true)

    // New access token must fail
    const verified = runtime.auth.verifyAccessToken(tokens.accessToken)
    expect(verified.ok).toBe(false)

    // Refresh with rotated token after revoke fails
    await expect(
      refreshNodeAccess({
        baseUrl: runtime.server.url,
        refreshToken: tokens.refreshToken,
        devicePrivateKeyPem: device.privateKeyPem,
        clientSessionId: paired.clientSessionId,
      }),
    ).rejects.toThrow()
    client.close()
  })

  it('detects identity fingerprint mismatch after regenerate and blocks connect', async () => {
    const runtime = await bootNode('clone-test')
    const desktopData = temp('superone-p1-id-')
    const store = new NodeCredentialStore(desktopData)
    const manager = new NodeConnectionManager({ credentialStore: store })

    const pair = runtime.auth.createPairingToken()
    const { connectionId, descriptor } = await manager.pairAndConnect({
      baseUrl: runtime.server.url,
      pairingToken: pair.token,
      label: 'box',
    })
    const oldFp = descriptor.nodePublicKeyFingerprint!
    expect(oldFp).toBeTruthy()
    const oldEnv = descriptor.environmentId
    const nodeHome = runtime.config.nodeHome

    manager.disconnect(connectionId)
    await runtime.stop()
    // remove from runtimes so afterEach does not double-stop
    const idx = runtimes.indexOf(runtime)
    if (idx >= 0) runtimes.splice(idx, 1)

    const newIdentity = regenerateIdentity(nodeHome, 'clone-test')
    expect(newIdentity.publicKeyFingerprint).not.toBe(oldFp)
    expect(newIdentity.environmentId).not.toBe(oldEnv)

    const port = 24000 + Math.floor(Math.random() * 10000)
    const rt2 = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      bindPort: port,
      label: 'clone-test', simulatedHarness: true })
    runtimes.push(rt2)

    // Point stored credentials at the new listen URL (same data dir, new identity).
    const store2 = new NodeCredentialStore(desktopData)
    const cred = store2.get(connectionId)!
    expect(cred.environmentId).toBe(oldEnv)
    expect(cred.nodePublicKeyFingerprint).toBe(oldFp)
    store2.save({ ...cred, baseUrl: rt2.server.url })

    const manager2 = new NodeConnectionManager({ credentialStore: store2 })
    let thrown: unknown
    try {
      await manager2.connectExisting(connectionId)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeTruthy()
    const e = thrown as { code?: string; message?: string }
    expect(e.code).toBe('identity_conflict')
  })

  it('enforces single-use pairing token and single-use ws ticket', async () => {
    const runtime = await bootNode()
    const device = generateDeviceKeyPair()
    const pair = runtime.auth.createPairingToken()
    await pairWithNode({
      baseUrl: runtime.server.url,
      pairingToken: pair.token,
      devicePublicKeyPem: device.publicKeyPem,
    })
    await expect(
      pairWithNode({
        baseUrl: runtime.server.url,
        pairingToken: pair.token,
        devicePublicKeyPem: device.publicKeyPem,
      }),
    ).rejects.toThrow()

    const pair2 = runtime.auth.createPairingToken()
    const device2 = generateDeviceKeyPair()
    const paired = await pairWithNode({
      baseUrl: runtime.server.url,
      pairingToken: pair2.token,
      devicePublicKeyPem: device2.publicKeyPem,
    })
    const tokens = await refreshNodeAccess({
      baseUrl: runtime.server.url,
      refreshToken: paired.refreshToken,
      devicePrivateKeyPem: device2.privateKeyPem,
      clientSessionId: paired.clientSessionId,
    })
    const ticket = await mintWsTicket({ baseUrl: runtime.server.url, accessToken: tokens.accessToken })
    const c1 = new NodeRpcClient({
      baseUrl: runtime.server.url,
      getWsTicket: async () => ticket,
      devicePrivateKeyPem: device2.privateKeyPem,
      expectedEnvironmentId: paired.environmentId,
    })
    await c1.connect()
    c1.close()
    const c2 = new NodeRpcClient({
      baseUrl: runtime.server.url,
      getWsTicket: async () => ticket,
      devicePrivateKeyPem: device2.privateKeyPem,
      expectedEnvironmentId: paired.environmentId,
    })
    await expect(c2.connect()).rejects.toBeTruthy()
  })
})

// re-export sign helper usage guard
void signWithDeviceKey
