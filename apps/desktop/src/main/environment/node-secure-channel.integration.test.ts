import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

import { verifyPayload } from '@superone/runtime/crypto/crypto-util'
import { openNodeDatabase } from '@superone/runtime/db/database'
import {
  AuthService,
  deriveIssuedChannelSecret,
  issueChannelCredential,
  loadOrCreateChannelRoot,
  loadOrCreateIdentity,
  startNodeServer,
  type NodeServerHandle,
} from '@superone/runtime/server'
import { NodeConnectionManager } from './node-connection-manager'
import { NodeCredentialStore } from './node-credential-store'

const dirs: string[] = []
const servers: NodeServerHandle[] = []

afterEach(async () => {
  while (servers.length) await servers.pop()?.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  electron.store.clear()
})

async function startEncryptedNode() {
  const nodeHome = mkdtempSync(join(tmpdir(), 'superone-enc-node-'))
  dirs.push(nodeHome)
  const identity = loadOrCreateIdentity(nodeHome, 'encrypted-node')
  const auth = new AuthService(openNodeDatabase(join(nodeHome, 'state.sqlite')), identity)
  const root = loadOrCreateChannelRoot(nodeHome)
  const server = await startNodeServer({
    identity,
    auth,
    bindHost: '127.0.0.1',
    bindPort: 0,
    dispatchRpc: async (method) => {
      if (method === 'environment.descriptor') {
        return {
          result: {
            environmentId: identity.environmentId,
            nodePublicKeyFingerprint: identity.publicKeyFingerprint,
            label: identity.label,
            capabilities: {},
          },
        }
      }
      if (method === 'environment.health') return { result: { ok: true, environmentId: identity.environmentId, uptimeMs: 1 } }
      return { error: { code: 'not_found', message: method } }
    },
    createRpcContext: () => ({}) as never,
    onClientDisconnected: () => {},
    verifyDeviceProof: verifyPayload,
    secureChannel: { resolveSecret: (keyId) => deriveIssuedChannelSecret(root, keyId) },
  })
  servers.push(server)
  return { identity, auth, root, server }
}

describe('desktop client over the encrypted node channel', () => {
  it('pairs with the out-of-band credential, connects, and reconnects from stored credentials', async () => {
    const { identity, auth, root, server } = await startEncryptedNode()
    const desktopData = mkdtempSync(join(tmpdir(), 'superone-enc-desktop-'))
    dirs.push(desktopData)

    const pairing = auth.createPairingToken()
    const channel = issueChannelCredential(root, pairing.tokenId)
    const store = new NodeCredentialStore(desktopData)
    const manager = new NodeConnectionManager({ credentialStore: store })

    // Plain pairing is refused by a node that requires the channel.
    await expect(
      manager.pairAndConnect({ baseUrl: server.url, pairingToken: pairing.token, label: 'B' }),
    ).rejects.toMatchObject({ code: 'channel_required' })

    const { connectionId, descriptor } = await manager.pairAndConnect({
      baseUrl: server.url,
      pairingToken: pairing.token,
      label: 'B',
      channel,
    })
    expect(descriptor.environmentId).toBe(identity.environmentId)
    expect(await manager.getClient(connectionId)!.health()).toMatchObject({ ok: true })

    // The secret is stored only inside the encrypted secrets blob.
    const onDisk = readFileSync(join(desktopData, 'node-credentials', 'credentials.json'), 'utf8')
    expect(onDisk).not.toContain(channel.secretHex)
    const reloaded = new NodeCredentialStore(desktopData)
    expect(reloaded.get(connectionId)?.channel).toEqual(channel)

    manager.disconnect(connectionId)
    const again = new NodeConnectionManager({
      credentialStore: reloaded,
      loadKnownEnvironments: () => manager.listKnown(),
    })
    const reconnected = await again.connectExisting(connectionId)
    expect(reconnected.environmentId).toBe(identity.environmentId)
    again.disconnectAll()
  })

  it('blocks with unauthorized when the pairing secret is wrong', async () => {
    const { auth, server } = await startEncryptedNode()
    const desktopData = mkdtempSync(join(tmpdir(), 'superone-enc-desktop-'))
    dirs.push(desktopData)
    const pairing = auth.createPairingToken()
    const manager = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(desktopData) })
    await expect(
      manager.pairAndConnect({
        baseUrl: server.url,
        pairingToken: pairing.token,
        label: 'B',
        channel: { keyId: pairing.tokenId, secretHex: 'ab'.repeat(32) },
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })
})
