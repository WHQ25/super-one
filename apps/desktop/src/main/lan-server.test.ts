vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('./agent/event-trace', () => ({ trace: vi.fn() }))

import WebSocket from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openLinkFrame } from '@superone/relay-client/phone-link'
import { issueChannelCredential, startClientHandshake, type ChannelCredential } from '@superone/relay-client/secure-channel'
import { RelayClient } from '@superone/relay-client'
import { LanServer, type LanServerCallbacks } from './lan-server'
import * as phoneLink from './remote/phone-link-host'
import { connectTestPhone, nextFrame, openLanSocket, sealTestRpc } from './remote/test-phone'
import log from './logger'
import { phoneDomain } from './node-host/phone-endpoint-test-fixtures'
import { openPhoneConnection as openNativePhoneConnection } from './node-host/phone-endpoint'
import type { SessionLoadResult } from '@superone/shared/environment'

const ROOT = 'ab'.repeat(32)
const ROOM = '0f'.repeat(16)
const PHONES: Record<string, { deviceId: string; deviceName: string; enabled?: boolean }> = {
  'key-dev-1': { deviceId: 'dev-1', deviceName: 'iPhone' },
  'key-dev-2': { deviceId: 'dev-2', deviceName: 'Pixel' },
}
const credentialOf = (keyId: string): ChannelCredential => issueChannelCredential(ROOT, keyId)

function makeServer(overrides: Partial<LanServerCallbacks> = {}, paired = PHONES): LanServer {
  return new LanServer({
    phoneLink,
    resolveKey: (keyId) => paired[keyId]
      ? { enabled: true, ...paired[keyId], keyId, secretHex: credentialOf(keyId).secretHex }
      : null,
    handshakeInfo: () => ({ hostName: 'test-host' }),
    ...overrides,
  })
}

const connectPhone = (port: number, credential = credentialOf('key-dev-1')) => connectTestPhone(port, credential)
const open = openLanSocket
const command = sealTestRpc

const closed = (socket: WebSocket) => new Promise<{ code: number; reason: string }>((r) =>
  socket.once('close', (code, reason) => r({ code, reason: reason.toString() })))

describe('LanServer', () => {
  let server: LanServer | null = null
  const sockets: WebSocket[] = []
  const domains: Array<() => void> = []
  const track = <T extends { socket: WebSocket }>(value: T): T => { sockets.push(value.socket); return value }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.close()
      socket.removeAllListeners()
    }
    await server?.stop()
    server = null
    while (domains.length) domains.pop()!()
  })

  it('accepts a phone that proves its key and sends the sealed handshake', async () => {
    const onClientRegistered = vi.fn()
    server = makeServer({ onClientRegistered })
    const { port } = await server.start({ host: '127.0.0.1' })
    const phone = track(await connectPhone(port))
    expect(phone.handshake).toEqual({ t: 'handshake', hostName: 'test-host' })
    // The device comes from the key, not from anything the phone claims.
    expect(onClientRegistered).toHaveBeenCalledWith({ deviceName: 'iPhone', deviceId: 'dev-1' })
  })

  it('kicks a phone whose key was revoked, and refuses a cleartext register', async () => {
    server = makeServer({}, { 'key-dev-2': PHONES['key-dev-2'] })
    const { port } = await server.start({ host: '127.0.0.1' })

    const revoked = await open(port)
    sockets.push(revoked)
    const revokedClosed = closed(revoked)
    const kicked = nextFrame(revoked, (f) => f.type === 'kicked')
    revoked.send(JSON.stringify({ type: 'channel', msg: startClientHandshake(credentialOf('key-dev-1')).hello }))
    expect(await kicked).toEqual({ type: 'kicked' })
    expect(await revokedClosed).toEqual({ code: 1008, reason: 'not_paired' })

    const legacy = await open(port)
    sockets.push(legacy)
    const legacyClosed = closed(legacy)
    legacy.send(JSON.stringify({ type: 'register', deviceName: 'Spoof', mobileDeviceId: 'dev-2' }))
    expect(await legacyClosed).toEqual({ code: 1008, reason: 'channel_required' })
  })

  it('turns a switched-off phone away without kicking it, so it stays paired', async () => {
    server = makeServer({}, { 'key-dev-1': { ...PHONES['key-dev-1']!, enabled: false } })
    const { port } = await server.start({ host: '127.0.0.1' })
    const socket = await open(port)
    sockets.push(socket)
    const frames: Array<Record<string, unknown>> = []
    socket.on('message', (raw) => frames.push(JSON.parse(raw.toString())))
    const socketClosed = closed(socket)
    const hs = startClientHandshake(credentialOf('key-dev-1'))
    const challenge = nextFrame(socket, (f) => f.type === 'channel')
    socket.send(JSON.stringify({ type: 'channel', msg: hs.hello }))
    socket.send(JSON.stringify({ type: 'channel', msg: hs.finish((await challenge).msg).proof }))
    expect(await socketClosed).toEqual({ code: 1008, reason: 'access_off' })
    expect(frames.some((f) => f.type === 'kicked')).toBe(false)
  })

  it('refuses a phone that knows the key id but not the secret', async () => {
    server = makeServer()
    const { port } = await server.start({ host: '127.0.0.1' })
    const socket = await open(port)
    sockets.push(socket)
    const wrong = { keyId: 'key-dev-1', secretHex: credentialOf('key-dev-2').secretHex }
    const hs = startClientHandshake(wrong)
    const challenge = nextFrame(socket, (f) => f.type === 'channel')
    socket.send(JSON.stringify({ type: 'channel', msg: hs.hello }))
    // The host proves itself first; an impostor cannot verify it and cannot forge its own proof.
    const reply = await challenge
    expect(() => hs.finish(reply.msg)).toThrow(expect.objectContaining({ code: 'channel_auth_failed' }))
    const socketClosed = closed(socket)
    socket.send(JSON.stringify({ type: 'channel', msg: { type: 'channel_proof', v: 1, proof: (reply.msg as { proof: string }).proof } }))
    expect(await socketClosed).toEqual({ code: 1008, reason: 'channel_failed' })
    expect(server.isEmpty()).toBe(true)
  })

  describe('removing a device mid-handshake', () => {
    /** A phone that has said hello and holds the host's challenge, but has not sent its proof. */
    async function challenged(port: number) {
      const socket = await open(port)
      sockets.push(socket)
      const hs = startClientHandshake(credentialOf('key-dev-1'))
      const challenge = nextFrame(socket, (f) => f.type === 'channel')
      socket.send(JSON.stringify({ type: 'channel', msg: hs.hello }))
      const { proof, channel } = hs.finish((await challenge).msg)
      return { socket, channel, sendProof: () => socket.send(JSON.stringify({ type: 'channel', msg: proof })) }
    }

    it('revoking the device closes its pending handshake', async () => {
      const paired = { ...PHONES }
      const onClientRegistered = vi.fn()
      const openPhoneConnection = vi.fn(() => ({ receive: vi.fn(), close: vi.fn() }))
      server = makeServer({ onClientRegistered, openPhoneConnection }, paired)
      const { port } = await server.start({ host: '127.0.0.1' })
      const phone = await challenged(port)
      const kicked = nextFrame(phone.socket, (f) => f.type === 'kicked')
      const socketClosed = closed(phone.socket)
      delete paired['key-dev-1']
      server.kickDevice('dev-1')
      expect(await kicked).toEqual({ type: 'kicked', mobileDeviceId: 'dev-1' })
      expect(await socketClosed).toEqual({ code: 1000, reason: 'kicked' })
      expect(onClientRegistered).not.toHaveBeenCalled()
      expect(openPhoneConnection).not.toHaveBeenCalled()
    })

    it('a proof that arrives after the pairing was deleted is rejected', async () => {
      const paired = { ...PHONES }
      const onClientRegistered = vi.fn()
      const openPhoneConnection = vi.fn(() => ({ receive: vi.fn(), close: vi.fn() }))
      server = makeServer({ onClientRegistered, openPhoneConnection }, paired)
      const { port } = await server.start({ host: '127.0.0.1' })
      const phone = await challenged(port)
      delete paired['key-dev-1']
      const socketClosed = closed(phone.socket)
      phone.sendProof()
      phone.socket.send(command(phone.channel, { type: 'rpc', method: 'project.list', requestId: 'r1' }))
      expect(await socketClosed).toEqual({ code: 1008, reason: 'not_paired' })
      expect(onClientRegistered).not.toHaveBeenCalled()
      expect(openPhoneConnection).not.toHaveBeenCalled()
      expect(server.isEmpty()).toBe(true)
    })

    it('a command on an open channel is refused once the pairing is gone', async () => {
      const paired = { ...PHONES }
      const openPhoneConnection = vi.fn(() => ({ receive: vi.fn(), close: vi.fn() }))
      server = makeServer({ openPhoneConnection }, paired)
      const { port } = await server.start({ host: '127.0.0.1' })
      const phone = track(await connectPhone(port))
      delete paired['key-dev-1']
      const socketClosed = closed(phone.socket)
      phone.socket.send(command(phone.channel, { type: 'rpc', method: 'project.list', requestId: 'r1' }))
      expect(await socketClosed).toEqual({ code: 1000, reason: 'kicked' })
      expect(openPhoneConnection).not.toHaveBeenCalled()
    })
  })

  it('binds native protocol frames to the authenticated socket and device', async () => {
    const received = vi.fn()
    server = makeServer({ openPhoneConnection: link => ({ receive: frame => { received(link.deviceId, frame); link.write(frame) }, close: () => {} }) })
    const { port } = await server.start({ host: '127.0.0.1' })
    const phone = track(await connectPhone(port))
    const response = nextFrame(phone.socket, f => f.type === 'terminal')
    const payload = { type: 'rpc_result', requestId: 'r1', result: { value: 42 } }
    phone.socket.send(command(phone.channel, payload))
    const frame = openLinkFrame(phone.channel, (await response).data as string)
    expect(frame.header).toEqual({ t: 'rpc' })
    expect(JSON.parse(new TextDecoder().decode(frame.payload))).toEqual(payload)
    expect(received).toHaveBeenCalledWith('dev-1', expect.any(Uint8Array))
  })

  it('drops the connection on a replayed or tampered command', async () => {
    const openPhoneConnection = vi.fn(() => ({ receive: vi.fn(), close: vi.fn() }))
    server = makeServer({ openPhoneConnection })
    const { port } = await server.start({ host: '127.0.0.1' })

    const phone = track(await connectPhone(port))
    const frame = command(phone.channel, { type: 'rpc', method: 'project.list', requestId: 'once' })
    phone.socket.send(frame)
    await vi.waitFor(() => expect(openPhoneConnection).toHaveBeenCalledTimes(1))
    const replayClosed = closed(phone.socket)
    phone.socket.send(frame)
    expect(await replayClosed).toEqual({ code: 1008, reason: 'decryption_failed' })
    expect(openPhoneConnection).toHaveBeenCalledTimes(1)

    const other = track(await connectPhone(port))
    const tampered = JSON.parse(command(other.channel, { type: 'rpc', method: 'project.list' })) as { data: string }
    const bytes = Buffer.from(tampered.data, 'base64')
    bytes[bytes.length - 1] ^= 1
    const tamperClosed = closed(other.socket)
    other.socket.send(JSON.stringify({ type: 'command', data: bytes.toString('base64') }))
    expect(await tamperClosed).toEqual({ code: 1008, reason: 'decryption_failed' })
    expect(openPhoneConnection).toHaveBeenCalledTimes(1)
  })

  it('seals native frames per socket without forwarding frames to other phones', async () => {
    server = makeServer({ openPhoneConnection: link => ({ receive: frame => link.write(frame), close: () => {} }) })
    const { port } = await server.start({ host: '127.0.0.1' })
    const a = track(await connectPhone(port, credentialOf('key-dev-1')))
    const b = track(await connectPhone(port, credentialOf('key-dev-2')))
    const both = Promise.all([nextFrame(a.socket, f => f.type === 'terminal'), nextFrame(b.socket, f => f.type === 'terminal')])
    const payload = { type: 'rpc_result', requestId: 'r1', result: {} }
    a.socket.send(command(a.channel, payload))
    b.socket.send(command(b.channel, payload))
    const [fa, fb] = await both
    expect(fa.data).not.toBe(fb.data)
    expect(openLinkFrame(a.channel, fa.data as string).header).toEqual({ t: 'rpc' })
    expect(openLinkFrame(b.channel, fb.data as string).header).toEqual({ t: 'rpc' })
    let bReceived = false
    b.socket.on('message', () => { bReceived = true })
    const onlyA = nextFrame(a.socket, f => f.type === 'terminal')
    a.socket.send(command(a.channel, { ...payload, requestId: 'r2' }))
    expect(openLinkFrame(a.channel, (await onlyA).data as string).header).toEqual({ t: 'rpc' })
    await new Promise(r => setTimeout(r, 50))
    expect(bReceived).toBe(false)
  })

  it('broadcasts desktop_shutdown and tracks registered clients', async () => {
    server = makeServer()
    const { port } = await server.start({ host: '127.0.0.1' })
    expect(server.isEmpty()).toBe(true)
    const phone = track(await connectPhone(port))
    expect(server.isEmpty()).toBe(false)
    const shutdown = nextFrame(phone.socket, (f) => f.type === 'desktop_shutdown')
    await server.broadcastShutdown()
    expect(await shutdown).toEqual({ type: 'desktop_shutdown' })
    phone.socket.close()
    await vi.waitFor(() => expect(server!.isEmpty()).toBe(true), { timeout: 2000 })
  })

  it('replaces a redialling device socket without reporting the device offline', async () => {
    const onClientDisconnected = vi.fn()
    server = makeServer({ onClientDisconnected })
    const { port } = await server.start({ host: '127.0.0.1' })

    const stale = await connectPhone(port)
    const staleClosed = closed(stale.socket)
    const fresh = track(await connectPhone(port))
    expect((await staleClosed).code).toBe(1000)
    await vi.waitFor(() => expect(log.info).toHaveBeenCalledWith(
      '[CONN-DESK] LAN socket closed deviceId=%s replaced=%s', 'dev-1', true,
    ), { timeout: 2000 })
    expect(onClientDisconnected).not.toHaveBeenCalled()

    fresh.socket.close()
    await vi.waitFor(() => expect(onClientDisconnected).toHaveBeenCalledWith({ deviceId: 'dev-1' }), { timeout: 2000 })
  })

  it('serves the native phone transport end to end: handshake, RPC, events, revocation', async () => {
    const { domain, projectDir, own } = phoneDomain(domains)
    const paired = { ...PHONES }
    server = makeServer({
      handshakeInfo: () => ({ hostName: 'test-host', host: { appVersion: '0.73.0-alpha.1', protocol: 3, environmentId: domain.identity.environmentId } }),
      openPhoneConnection: link => openNativePhoneConnection(domain, link),
    }, paired)
    const { port } = await server.start({ host: '127.0.0.1' })

    const controls: unknown[] = []
    const events: unknown[][] = []
    const client = new RelayClient({ onControl: (f) => controls.push(f), onEvents: (batch) => events.push(batch) })
    const link = { credential: credentialOf('key-dev-1'), roomId: ROOM }
    await client.connectLan('127.0.0.1', port, link)
    await client.verifyHost()
    await expect(client.rpc('project.list')).resolves.toMatchObject([{ path: projectDir, name: 'app' }])
    expect(controls).toContainEqual(expect.objectContaining({ type: 'handshake', hostName: 'test-host' }))
    const loaded = await client.rpc<SessionLoadResult>('session.load', { sessionId: 'own' })
    await client.followSession({ session: { environmentId: domain.identity.environmentId, sessionId: 'own' }, projectPath: projectDir, cursor: loaded.cursor })

    own.emitHostEvent({ type: 'status_change', status: 'error' })
    await vi.waitFor(() => expect(events.flat()).toContainEqual(expect.objectContaining({ type: 'status_change', status: 'error' })))

    // Removing the device: its live socket is kicked and its key no longer opens a channel.
    delete paired['key-dev-1']
    server.kickDevice('dev-1')
    await vi.waitFor(() => expect(controls).toContainEqual(expect.objectContaining({ type: 'kicked' })))
    client.disconnect()
    const again: unknown[] = []
    const retry = new RelayClient({ onControl: (f) => again.push(f) })
    await retry.connectLan('127.0.0.1', port, link)
    await vi.waitFor(() => expect(again).toContainEqual({ type: 'kicked' }))
    await expect(retry.rpc('project.list', {}, { timeoutMs: 500 })).rejects.toThrow()
    retry.disconnect()
  })
})
