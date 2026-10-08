import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveIssuedChannelSecret, issueChannelCredential } from '@superone/relay-client/secure-channel'
import { generateEd25519KeyPair, verifyPayload } from '../crypto/crypto-util'
import { openNodeDatabase } from '../db/database'
import { AuthService } from './auth-service'
import { loadOrCreateChannelRoot, loadOrCreateIdentity } from './identity'
import { startNodeServer, type NodeServerHandle } from './node-server'
import { RelaySlotSocket, RelayNodeHost, createRelayNodeDialer, encodeNodeRelayFrame, nodeRelayRoomId } from './relay-node-link'
import { establishSecureChannel, secureChannelAuthRequest } from './secure-channel-client'
import { startTestRelay } from './test-relay'

const cleanup: Array<() => unknown> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

async function nodeBehindRelay() {
  const relay = await startTestRelay()
  cleanup.push(() => relay.close())
  const nodeHome = mkdtempSync(join(tmpdir(), 'superone-relay-node-'))
  cleanup.push(() => rmSync(nodeHome, { recursive: true, force: true }))
  const identity = loadOrCreateIdentity(nodeHome, 'relay-test')
  const auth = new AuthService(openNodeDatabase(join(nodeHome, 'state.sqlite')), identity)
  const root = loadOrCreateChannelRoot(nodeHome)
  const server: NodeServerHandle = await startNodeServer({
    identity,
    auth,
    bindHost: '127.0.0.1',
    bindPort: 0,
    dispatchRpc: async (method) => ({ result: { method } }),
    createRpcContext: () => ({}) as never,
    onClientDisconnected: () => {},
    verifyDeviceProof: verifyPayload,
    secureChannel: { resolveSecret: (keyId) => deriveIssuedChannelSecret(root, keyId) },
  })
  cleanup.push(() => server.close())
  const roomId = nodeRelayRoomId(root)
  const host = new RelayNodeHost({ relayUrl: relay.url, roomId, onSocket: (s) => server.acceptChannelSocket(s) })
  host.start()
  cleanup.push(() => host.stop())
  await vi.waitFor(() => expect(relay.hasDesktop(roomId)).toBe(true))
  return { relay, auth, root, roomId, dial: createRelayNodeDialer({ relayUrl: relay.url, roomId }) }
}

describe('node relay framing', () => {
  it('carries handshake text as msg and splits large binary frames', () => {
    expect(encodeNodeRelayFrame('{"type":"channel_hello"}')).toEqual([{ type: 'channel', msg: { type: 'channel_hello' } }])
    const big = new Uint8Array(1_500_000).map((_, i) => i % 251)
    const parts = encodeNodeRelayFrame(big)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.slice(0, -1).every((p) => p.more === true)).toBe(true)
    expect(parts.at(-1)!.more).toBeUndefined()

    const received: Array<[Buffer, boolean]> = []
    const socket = new RelaySlotSocket(() => true, () => {})
    socket.on('message', (data: Buffer, isBinary: boolean) => received.push([data, isBinary]))
    socket.markOpen()
    for (const part of parts) socket.receive(part)
    expect(received).toHaveLength(1)
    expect(received[0][1]).toBe(true)
    expect(Buffer.compare(received[0][0], Buffer.from(big))).toBe(0)
  })

  it('derives a stable room id that is not the root', () => {
    const root = 'ab'.repeat(32)
    expect(nodeRelayRoomId(root)).toMatch(/^[0-9a-f]{32}$/)
    expect(nodeRelayRoomId(root)).toBe(nodeRelayRoomId(root))
    expect(root).not.toContain(nodeRelayRoomId(root))
  })
})

describe('node channel over the relay', () => {
  it('pairs and refreshes through relay slots without exposing secrets', async () => {
    const { relay, auth, root, dial } = await nodeBehindRelay()
    const pairing = auth.createPairingToken()
    const credential = issueChannelCredential(root, pairing.tokenId)
    const device = generateEd25519KeyPair()
    const paired = await secureChannelAuthRequest({
      wsUrl: 'ws://unused/ws',
      dial,
      credential,
      path: '/v1/pair',
      body: { pairingToken: pairing.token, devicePublicKeyPem: device.publicKeyPem, label: 'peer' },
      timeoutMs: 5_000,
    })
    expect(paired.status).toBe(200)
    const wire = relay.seen.join('\n')
    expect(wire).not.toContain(credential.secretHex)
    expect(wire).not.toContain(pairing.token)
    expect(wire).not.toContain('/v1/pair')
  })

  it('fails a wrong secret as unauthorized', async () => {
    const { auth, dial } = await nodeBehindRelay()
    const pairing = auth.createPairingToken()
    const socket = dial('ws://unused/ws')
    cleanup.push(() => socket.close())
    await new Promise<void>((resolve) => socket.once('open', () => resolve()))
    await expect(
      establishSecureChannel(socket, { keyId: pairing.tokenId, secretHex: 'cd'.repeat(32) }, 5_000),
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('closes a client connection when the node leaves the relay', async () => {
    const { auth, root, dial } = await nodeBehindRelay()
    const pairing = auth.createPairingToken()
    const socket = dial('ws://unused/ws')
    await new Promise<void>((resolve) => socket.once('open', () => resolve()))
    await establishSecureChannel(socket, issueChannelCredential(root, pairing.tokenId), 5_000)
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)))
    // Stopping the node host drops its relay socket: the slot learns the node left.
    await cleanup.splice(cleanup.length - 1, 1)[0]()
    expect(await closed).toBeGreaterThan(1000)
  })
})

describe('node server address filter', () => {
  it('drops a connection whose peer address is refused before any HTTP work', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'superone-filter-'))
    cleanup.push(() => rmSync(nodeHome, { recursive: true, force: true }))
    const identity = loadOrCreateIdentity(nodeHome, 'filter')
    const seen: Array<string | undefined> = []
    const server = await startNodeServer({
      identity,
      auth: new AuthService(openNodeDatabase(join(nodeHome, 'state.sqlite')), identity),
      bindHost: '127.0.0.1',
      bindPort: 0,
      dispatchRpc: async () => ({ result: null }),
      createRpcContext: () => ({}) as never,
      onClientDisconnected: () => {},
      verifyDeviceProof: verifyPayload,
      allowRemoteAddress: (address) => {
        seen.push(address)
        return false
      },
    })
    cleanup.push(() => server.close())
    await expect(fetch(`${server.url}/health`)).rejects.toThrow()
    expect(seen[0]).toMatch(/127\.0\.0\.1/)
  })
})
