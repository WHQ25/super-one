import { describe, expect, it } from 'vitest'
import { RelayClient, type HostLink, type SocketLike } from '@superone/relay-client'
import { LINK_CHANNEL_FRAME, sealLinkFrame } from '@superone/relay-client/phone-link'
import { acceptClientHello, issueChannelCredential, type SecureChannel } from '@superone/relay-client/secure-channel'
import { WireEncoder, WireDecoder, encodePlainMessage } from '@superone/shared/environment/wire'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { openLinkFrame } from '@superone/relay-client/phone-link'
import { MIN_PHONE_DESKTOP_VERSION } from '@superone/relay-client/phone-protocol'
import { RelaySession } from '../src/relay-session'
import { createMockState, createMockWebSocket } from '../src/test-durable-object'

/**
 * Cross-layer: phones (the real `RelayClient`) and a host that seals one copy per phone
 * channel, as the desktop does, talking through a real `RelaySession`. Lives
 * outside `src` so the Worker typecheck does not compile the phone client.
 */

const ROOT = 'ab'.repeat(32)
const PHONES: Record<string, string> = { 'dev-1': 'key-dev-1', 'dev-2': 'key-dev-2' }
type ServerSocket = ReturnType<typeof createMockWebSocket>

function setup() {
  const state = createMockState()
  const session = new RelaySession(state as any, {} as any)
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  /** The host's channels by device; a hello starts that device over. */
  const channels = new Map<string, SecureChannel>()
  const codecs = new Map<string, { encoder: WireEncoder; decoder: WireDecoder }>()
  const pending = new Map<string, ReturnType<typeof acceptClientHello>>()
  let desktop: ServerSocket | undefined

  function attachDesktop(): void {
    if (desktop) desktop.readyState = WebSocket.CLOSED
    const ws = createMockWebSocket()
    ws.send.mockImplementation((text: string) => queueMicrotask(() => onRelayFrame(JSON.parse(text))))
    state.acceptWebSocket(ws, ['desktop'])
    desktop = ws
    channels.clear()
    codecs.clear()
    pending.clear()
    // As `RelaySession.fetch` does for a desktop that (re)joins.
    for (const mobile of state.getWebSockets() as ServerSocket[]) {
      if (mobile !== ws && mobile.readyState === WebSocket.OPEN && state.getTags(mobile)[0]?.startsWith('mobile:')) {
        mobile.send(JSON.stringify({ type: 'peer_connected' }))
      }
    }
  }

  function toRelay(frame: unknown): Promise<void> {
    return session.webSocketMessage(desktop! as any, JSON.stringify(frame))
  }

  function onRelayFrame(frame: { type: string; mobileDeviceId?: string; data?: string; msg?: { type?: string; nonce?: string } }): void {
    const deviceId = frame.mobileDeviceId
    if (!deviceId) return
    if (frame.type === 'command' && frame.data) {
      const channel = channels.get(deviceId)!
      const opened = openLinkFrame(channel, frame.data)
      if (opened.header.t !== 'rpc') throw new Error('native RPC required')
      const request = codecs.get(deviceId)!.decoder.decode(opened.payload) as { type?: string; requestId?: string } | undefined
      if (request?.type === 'handshake') void toRelay({ type: 'terminal', targets: [deviceId], data: sealLinkFrame(channel, { t: 'rpc' },
        encodePlainMessage({ type: 'handshake_ok', requestId: request.requestId, result: { protocol: 3, databaseSchema: 1, environmentId: 'desk' } })) })
      return
    }
    if (frame.type !== LINK_CHANNEL_FRAME) return
    if (frame.msg?.type === 'channel_hello') {
      channels.delete(deviceId)
      const accept = acceptClientHello(frame.msg, (keyId) => keyId === PHONES[deviceId] ? issueChannelCredential(ROOT, keyId).secretHex : null)
      pending.set(deviceId, accept)
      void toRelay({ type: LINK_CHANNEL_FRAME, msg: accept.challenge, hello: frame.msg.nonce, mobileDeviceId: deviceId })
      return
    }
    const accept = pending.get(deviceId)
    if (frame.msg?.type !== 'channel_proof' || !accept) return
    pending.delete(deviceId)
    const channel = accept.finish(frame.msg)
    channels.set(deviceId, channel)
    codecs.set(deviceId, { encoder: new WireEncoder({ deflate: (bytes, dictionary) => deflateRawSync(bytes, { dictionary }) }),
      decoder: new WireDecoder({ inflate: (bytes, _out, dictionary) => inflateRawSync(bytes, { dictionary }) }) })
    void toRelay({ type: LINK_CHANNEL_FRAME, data: sealLinkFrame(channel, { t: 'handshake', hostName: 'Desk', host: { appVersion: MIN_PHONE_DESKTOP_VERSION, protocol: 3, environmentId: 'desk' } }), mobileDeviceId: deviceId })
  }

  /** One sealed copy per phone with a channel, each addressed to that phone alone. */
  async function send(event: unknown, targets?: string[]): Promise<void> {
    for (const [deviceId, channel] of channels) {
      if (targets && !targets.includes(deviceId)) continue
      for (const framed of codecs.get(deviceId)!.encoder.encode({ type: 'client', event }, { push: true })) {
        await toRelay({ type: 'terminal', targets: [deviceId], data: sealLinkFrame(channel, { t: 'rpc' }, framed) })
      }
    }
  }

  function phone(deviceId: string) {
    const received: unknown[] = []
    let handshakes = 0
    const openSocket = (): SocketLike => {
      const server = createMockWebSocket()
      const client: SocketLike = {
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send(text) {
          if (text === 'ping') { queueMicrotask(() => client.onmessage?.({ data: 'pong' })); return }
          queueMicrotask(() => void session.webSocketMessage(server as any, text))
        },
        close() {
          server.readyState = WebSocket.CLOSED
          void session.webSocketClose(server as any)
        },
      }
      server.send.mockImplementation((text: string) => queueMicrotask(() => client.onmessage?.({ data: text })))
      // As `RelaySession.fetch` does for a phone that (re)joins.
      state.acceptWebSocket(server, [`mobile:${deviceId}`])
      desktop!.send(JSON.stringify({ type: 'peer_connected', mobileDeviceId: deviceId }))
      queueMicrotask(() => client.onopen?.())
      return client
    }
    const client = new RelayClient({
      openSocket,
      onProtocolMessage: message => received.push(message),
      onControl: (frame) => { if (frame.type === 'handshake') handshakes += 1 },
    })
    const link: HostLink = { credential: issueChannelCredential(ROOT, PHONES[deviceId]), roomId: '0f'.repeat(16) }
    return {
      client,
      received,
      handshakes: () => handshakes,
      connect: () => client.connectRelay({ relayUrl: 'wss://relay.test', link, deviceId }),
    }
  }

  async function settle(until: () => boolean): Promise<void> {
    for (let i = 0; i < 1_000 && !until(); i++) await tick()
    expect(until()).toBe(true)
  }

  attachDesktop()
  return { attachDesktop, send, phone, settle, channels }
}

describe('RelaySession with per-phone channels', () => {
  it('delivers every frame to two phones through sustained broadcast, targeted events, and channel rebuilds', async () => {
    const relay = setup()
    const a = relay.phone('dev-1')
    const b = relay.phone('dev-2')
    await a.connect()
    await b.connect()
    await relay.settle(() => a.handshakes() === 1 && b.handshakes() === 1)

    const expected: Record<string, unknown[]> = { 'dev-1': [], 'dev-2': [] }
    async function burst(from: number, to: number): Promise<void> {
      for (let i = from; i < to; i++) {
        const all = { type: 'all', i }
        await relay.send(all)
        expected['dev-1'].push(all)
        expected['dev-2'].push(all)
        if (i % 3 === 0) {
          const one = { type: 'one', i }
          await relay.send(one, ['dev-1'])
          expected['dev-1'].push(one)
        }
        if (i % 4 === 0) {
          const two = { type: 'two', i }
          await relay.send(two, ['dev-2'])
          expected['dev-2'].push(two)
        }
      }
      await relay.settle(() => a.received.length === expected['dev-1'].length && b.received.length === expected['dev-2'].length)
    }

    // Far past any per-phone window: each phone sees well over 2,048 frames.
    await burst(0, 2_200)
    expect(expected['dev-1'].length).toBeGreaterThan(2_048)
    expect(a.received).toEqual(expected['dev-1'])
    expect(b.received).toEqual(expected['dev-2'])

    // A phone redials: a fresh socket and channel, and delivery carries on.
    await a.client.reconnect()
    await relay.settle(() => a.handshakes() === 2)
    await burst(2_200, 2_400)
    expect(a.received).toEqual(expected['dev-1'])
    expect(b.received).toEqual(expected['dev-2'])

    // The desktop rejoins the room: every phone rebuilds its channel.
    relay.attachDesktop()
    await relay.settle(() => a.handshakes() === 3 && b.handshakes() === 2 && relay.channels.size === 2)
    await burst(2_400, 2_600)
    expect(a.received).toEqual(expected['dev-1'])
    expect(b.received).toEqual(expected['dev-2'])

    a.client.disconnect()
    b.client.disconnect()
  })
})
