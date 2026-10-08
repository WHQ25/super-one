import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_GENERATION, PROTOCOL_GENERATION } from '@superone/shared/environment'
import {
  deriveIssuedChannelSecret,
  issueChannelCredential,
  type ChannelCredential,
  type SecureChannel,
} from '@superone/relay-client/secure-channel'
import { generateEd25519KeyPair, signPayload, verifyPayload } from '../crypto/crypto-util'
import { openNodeDatabase } from '../db/database'
import { AuthService } from './auth-service'
import { loadOrCreateChannelRoot, loadOrCreateIdentity } from './identity'
import { startNodeServer, type NodeServerHandle } from './node-server'
import { establishSecureChannel, secureChannelAuthRequest } from './secure-channel-client'

const dirs: string[] = []
const servers: NodeServerHandle[] = []
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate()
  while (servers.length) await servers.pop()?.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function setup() {
  const nodeHome = mkdtempSync(join(tmpdir(), 'superone-channel-'))
  dirs.push(nodeHome)
  const identity = loadOrCreateIdentity(nodeHome, 'channel-test')
  const auth = new AuthService(openNodeDatabase(join(nodeHome, 'state.sqlite')), identity)
  const root = loadOrCreateChannelRoot(nodeHome)
  const server = await startNodeServer({
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
  servers.push(server)
  const pairing = auth.createPairingToken()
  // The pairing code carries the token and this credential; neither crosses the network in clear.
  const credential = issueChannelCredential(root, pairing.tokenId)
  return { identity, server, wsUrl: `${server.url.replace(/^http/, 'ws')}/ws`, pairing, credential }
}

async function openChannel(wsUrl: string, credential: ChannelCredential) {
  const ws = new WebSocket(wsUrl)
  sockets.push(ws)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  const channel = await establishSecureChannel(ws, credential, 5_000)
  return { ws, channel }
}

function nextSealed(ws: WebSocket, channel: SecureChannel): Promise<Record<string, unknown>> {
  return new Promise((resolve) => ws.once('message', (data) => resolve(channel.open(data as Buffer) as Record<string, unknown>)))
}

function nextClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })))
}

describe('node server encrypted channel', () => {
  it('pairs, refreshes, attaches and serves RPC entirely inside the channel', async () => {
    const { identity, wsUrl, pairing, credential, server } = await setup()

    const plainPair = await fetch(`${server.url}/v1/pair`, { method: 'POST', body: '{}' })
    expect(plainPair.status).toBe(403)
    expect(((await plainPair.json()) as { error: { code: string } }).error.code).toBe('channel_required')
    expect((await fetch(`${server.url}/health`)).status).toBe(200)

    const device = generateEd25519KeyPair()
    const paired = await secureChannelAuthRequest({
      wsUrl,
      credential,
      path: '/v1/pair',
      body: { pairingToken: pairing.token, devicePublicKeyPem: device.publicKeyPem, label: 'peer' },
      timeoutMs: 5_000,
    })
    expect(paired.status).toBe(200)
    const pairBody = paired.body as { clientSessionId: string; refreshToken: string; environmentId: string }
    expect(pairBody.environmentId).toBe(identity.environmentId)

    const proofPayload = `refresh:${pairBody.clientSessionId}:${Date.now()}`
    const token = await secureChannelAuthRequest({
      wsUrl,
      credential,
      path: '/v1/token',
      body: { refreshToken: pairBody.refreshToken, proofPayload, proofSignature: signPayload(device.privateKeyPem, proofPayload) },
      timeoutMs: 5_000,
    })
    expect(token.status).toBe(200)
    const ticketResponse = await secureChannelAuthRequest({
      wsUrl,
      credential,
      path: '/v1/ws-ticket',
      body: {},
      accessToken: (token.body as { accessToken: string }).accessToken,
      timeoutMs: 5_000,
    })
    const ticket = (ticketResponse.body as { ticket: string }).ticket

    const { ws, channel } = await openChannel(wsUrl, credential)
    const ticketId = ticket.split('.')[0]!
    ws.send(channel.seal({ type: 'rpc', requestId: 'early', method: 'environment.health' }))
    expect(await nextSealed(ws, channel)).toMatchObject({ type: 'rpc_error', error: { code: 'unauthorized' } })

    ws.send(channel.seal({ type: 'attach', requestId: 'a1', ticket, proof: ticketId, sig: signPayload(device.privateKeyPem, ticketId) }))
    expect(await nextSealed(ws, channel)).toEqual({ type: 'attach_ok', requestId: 'a1' })

    ws.send(
      channel.seal({
        type: 'handshake',
        requestId: 'h1',
        payload: { protocol: { ...PROTOCOL_GENERATION }, databaseSchema: { ...DATABASE_SCHEMA_GENERATION } },
      }),
    )
    expect(await nextSealed(ws, channel)).toMatchObject({ type: 'handshake_ok', requestId: 'h1' })

    const rpcFrame = channel.seal({
      type: 'rpc',
      requestId: 'r1',
      method: 'environment.health',
      environmentId: identity.environmentId,
      protocolVersion: PROTOCOL_GENERATION.current,
    })
    ws.send(rpcFrame)
    expect(await nextSealed(ws, channel)).toEqual({ type: 'rpc_result', requestId: 'r1', result: { method: 'environment.health' } })

    // A captured frame replayed on the same connection closes it.
    const closed = nextClose(ws)
    ws.send(rpcFrame)
    expect(await closed).toEqual({ code: 4401, reason: 'channel_replay' })
  })

  it('rejects a wrong secret, an unknown key id, and a ticket outside the channel', async () => {
    const { wsUrl, credential } = await setup()

    const wrongSecret = { keyId: credential.keyId, secretHex: 'ab'.repeat(32) }
    await expect(openChannel(wsUrl, wrongSecret)).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(openChannel(wsUrl, { keyId: 'unknown-key-id', secretHex: 'ab'.repeat(32) })).rejects.toMatchObject({
      code: 'unauthorized',
    })

    const ticketed = new WebSocket(wsUrl, { headers: { 'x-superone-ws-ticket': 'whatever' } })
    sockets.push(ticketed)
    await expect(
      new Promise((resolve, reject) => {
        ticketed.once('open', resolve)
        ticketed.once('error', reject)
      }),
    ).rejects.toThrow(/401/)
  })

  it('closes a socket that sends a tampered frame', async () => {
    const { wsUrl, credential } = await setup()
    const { ws, channel } = await openChannel(wsUrl, credential)
    const frame = channel.seal({ type: 'auth', requestId: 'x', path: '/v1/ws-ticket', body: {} })
    frame[frame.length - 1] ^= 0xff
    const closed = nextClose(ws)
    ws.send(frame)
    expect(await closed).toEqual({ code: 4401, reason: 'channel_decrypt' })
  })
})
