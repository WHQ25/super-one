vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('./agent/event-trace', () => ({ trace: vi.fn() }))

import WebSocket from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeHostPlaintext } from '@superone/relay-client/host-payload'
import { openLinkFrame } from '@superone/relay-client/phone-link'
import { issueChannelCredential, startClientHandshake, type ChannelCredential } from '@superone/relay-client/secure-channel'
import { RelayClient } from '@superone/relay-client'
import { LanServer, type LanServerCallbacks } from './lan-server'
import { frameHostPayload } from './remote/payload-codec'
import * as phoneLink from './remote/phone-link-host'
import { connectTestPhone, nextFrame, openLanSocket, sealTestCommand } from './remote/test-phone'
import log from './logger'

const ROOT = 'ab'.repeat(32)
const ROOM = '0f'.repeat(16)
const PHONES: Record<string, { deviceId: string; deviceName: string }> = {
  'key-dev-1': { deviceId: 'dev-1', deviceName: 'iPhone' },
  'key-dev-2': { deviceId: 'dev-2', deviceName: 'Pixel' },
}
const credentialOf = (keyId: string): ChannelCredential => issueChannelCredential(ROOT, keyId)

function makeServer(overrides: Partial<LanServerCallbacks> = {}, paired = PHONES): LanServer {
  return new LanServer({
    phoneLink,
    resolveKey: (keyId) => paired[keyId] ? { ...paired[keyId], secretHex: credentialOf(keyId).secretHex } : null,
    handshakeInfo: () => ({ hostName: 'test-host' }),
    onCommand: vi.fn(),
    ...overrides,
  })
}

const connectPhone = (port: number, credential = credentialOf('key-dev-1')) => connectTestPhone(port, credential)
const open = openLanSocket
const command = sealTestCommand

const closed = (socket: WebSocket) => new Promise<{ code: number; reason: string }>((r) =>
  socket.once('close', (code, reason) => r({ code, reason: reason.toString() })))

describe('LanServer', () => {
  let server: LanServer | null = null
  const sockets: WebSocket[] = []
  const track = <T extends { socket: WebSocket }>(value: T): T => { sockets.push(value.socket); return value }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.close()
      socket.removeAllListeners()
    }
    await server?.stop()
    server = null
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

  it('runs a command round trip and binds the response to the channel', async () => {
    const onCommand = vi.fn<LanServerCallbacks['onCommand']>((_cmd, respond) => { void respond('req-1', { ok: true, value: 42 }) })
    server = makeServer({ onCommand })
    const { port } = await server.start({ host: '127.0.0.1' })
    const phone = track(await connectPhone(port))

    const response = nextFrame(phone.socket, (f) => f.type === 'response')
    phone.socket.send(command(phone.channel, { type: 'list_projects', requestId: 'req-1' }))
    const frame = await response
    expect(onCommand.mock.calls[0]?.[0]).toMatchObject({ type: 'list_projects', requestId: 'req-1' })
    expect(onCommand.mock.calls[0]?.[2]).toEqual({ deviceId: 'dev-1' })
    const { header, payload } = openLinkFrame(phone.channel, frame.data as string)
    expect(header).toEqual({ t: 'response', requestId: 'req-1' })
    expect(decodeHostPlaintext(payload)).toEqual({ ok: true, value: 42 })
  })

  it('drops the connection on a replayed or tampered command', async () => {
    const onCommand = vi.fn()
    server = makeServer({ onCommand })
    const { port } = await server.start({ host: '127.0.0.1' })

    const phone = track(await connectPhone(port))
    const frame = command(phone.channel, { type: 'list_projects', requestId: 'once' })
    phone.socket.send(frame)
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledTimes(1))
    const replayClosed = closed(phone.socket)
    phone.socket.send(frame)
    expect(await replayClosed).toEqual({ code: 1008, reason: 'decryption_failed' })
    expect(onCommand).toHaveBeenCalledTimes(1)

    const other = track(await connectPhone(port))
    const tampered = JSON.parse(command(other.channel, { type: 'list_projects' })) as { data: string }
    const bytes = Buffer.from(tampered.data, 'base64')
    bytes[bytes.length - 1] ^= 1
    const tamperClosed = closed(other.socket)
    other.socket.send(JSON.stringify({ type: 'command', data: bytes.toString('base64') }))
    expect(await tamperClosed).toEqual({ code: 1008, reason: 'decryption_failed' })
    expect(onCommand).toHaveBeenCalledTimes(1)
  })

  it('seals events per device channel and honours targets', async () => {
    server = makeServer()
    const { port } = await server.start({ host: '127.0.0.1' })
    const a = track(await connectPhone(port, credentialOf('key-dev-1')))
    const b = track(await connectPhone(port, credentialOf('key-dev-2')))

    const framed = await frameHostPayload([{ type: 'pong' }])
    const both = Promise.all([nextFrame(a.socket, (f) => f.type === 'event'), nextFrame(b.socket, (f) => f.type === 'event')])
    server.sendFramed('event', framed, undefined, 7)
    const [fa, fb] = await both
    expect(fa.seq).toBe(7)
    expect(decodeHostPlaintext(openLinkFrame(a.channel, fa.data as string).payload)).toEqual([{ type: 'pong' }])
    expect(decodeHostPlaintext(openLinkFrame(b.channel, fb.data as string).payload)).toEqual([{ type: 'pong' }])
    // One phone's copy is useless to the other.
    expect(fa.data).not.toBe(fb.data)

    let bReceived = false
    b.socket.on('message', () => { bReceived = true })
    const onlyA = nextFrame(a.socket, (f) => f.type === 'terminal')
    server.sendFramed('terminal', framed, ['dev-1'])
    expect(openLinkFrame(a.channel, (await onlyA).data as string).header).toEqual({ t: 'terminal' })
    await new Promise((r) => setTimeout(r, 50))
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

  it('serves the phone transport end to end: handshake, request, events, revocation', async () => {
    const paired = { ...PHONES }
    server = makeServer({
      onCommand: (cmd, respond) => {
        if ('requestId' in cmd && typeof cmd.requestId === 'string') void respond(cmd.requestId, { projects: [{ path: '/p', name: 'p' }] })
      },
    }, paired)
    const { port } = await server.start({ host: '127.0.0.1' })

    const controls: unknown[] = []
    const events: unknown[][] = []
    const client = new RelayClient({ onControl: (f) => controls.push(f), onEvents: (batch) => events.push(batch) })
    const link = { credential: credentialOf('key-dev-1'), roomId: ROOM }
    await client.connectLan('127.0.0.1', port, link)
    await expect(client.request({ type: 'list_projects', requestId: 'r1' } as never)).resolves.toEqual({ projects: [{ path: '/p', name: 'p' }] })
    expect(controls).toContainEqual({ type: 'handshake', hostName: 'test-host' })

    server.sendFramed('event', await frameHostPayload({ type: 'status_change', status: 'idle' }), ['dev-1'], 1)
    await vi.waitFor(() => expect(events).toEqual([[{ type: 'status_change', status: 'idle' }]]))

    // Removing the device: its live socket is kicked and its key no longer opens a channel.
    delete paired['key-dev-1']
    server.kickDevice('dev-1')
    await vi.waitFor(() => expect(controls).toContainEqual(expect.objectContaining({ type: 'kicked' })))
    client.disconnect()
    const again: unknown[] = []
    const retry = new RelayClient({ onControl: (f) => again.push(f) })
    await retry.connectLan('127.0.0.1', port, link)
    await vi.waitFor(() => expect(again).toContainEqual({ type: 'kicked' }))
    await expect(retry.request({ type: 'list_projects', requestId: 'r2' } as never, 500)).rejects.toThrow()
    retry.disconnect()
  })
})
