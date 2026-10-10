import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer, type WebSocket as ServerSocket } from 'ws'

vi.mock('./remote-highlighter', () => ({
  initHighlighter: vi.fn(),
  highlightCodeSync: vi.fn(() => null),
  highlightCodeByLang: vi.fn(() => null),
  parseAnsiTokens: vi.fn(() => []),
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('./agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('./lan-advertiser', () => ({
  LanAdvertiser: class { async publish() {} async unpublish() {} isPublishing() { return false } },
}))

import { RelayClient, type HostLink } from '@superone/relay-client'
import { issueChannelCredential, startClientHandshake } from '@superone/relay-client/secure-channel'
import { sealLinkFrame } from '@superone/relay-client/phone-link'
import { nextFrame } from './remote/test-phone'
import { RemoteControlService, type PairedPhone } from './remote-control-service'
import { phoneDomain } from './node-host/phone-endpoint-test-fixtures'
import { openPhoneConnection } from './node-host/phone-endpoint'
import type { DesktopDomain } from './node-host/desktop-domain'
import type { SessionLoadResult } from '@superone/shared/environment'
import { encodePlainMessage } from '@superone/shared/environment/wire'

const ROOT = 'ab'.repeat(32)

/** The relay's routing contract (apps/relay `relay-session.ts`). */
async function startRelay() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  let desktop: ServerSocket | null = null
  const mobiles = new Map<string, ServerSocket>()
  const fromMobiles: Array<Record<string, unknown>> = []
  server.on('connection', (socket, req) => {
    const url = new URL(req.url ?? '/', 'http://relay')
    const role = url.searchParams.get('role')
    const deviceId = url.searchParams.get('deviceId') ?? ''
    if (role === 'desktop') {
      desktop = socket
      for (const mobile of mobiles.values()) mobile.send(JSON.stringify({ type: 'peer_connected' }))
    } else {
      mobiles.get(deviceId)?.close(1000, 'replaced')
      mobiles.set(deviceId, socket)
      desktop?.send(JSON.stringify({ type: 'peer_connected', mobileDeviceId: deviceId }))
    }
    socket.on('message', (raw) => {
      const text = raw.toString()
      if (text === 'ping') { socket.send('pong'); return }
      const frame = JSON.parse(text) as Record<string, unknown>
      if (role === 'desktop') {
        const to = (id: unknown) => mobiles.get(String(id))
        if (frame.type === 'event') for (const id of frame.targets as string[]) to(id)?.send(JSON.stringify({ type: 'event', data: frame.data }))
        else if (frame.type === 'terminal') for (const id of frame.targets as string[]) to(id)?.send(text)
        else to(frame.mobileDeviceId)?.send(text)
        return
      }
      if (frame.type === 'command' || frame.type === 'channel') {
        const stamped = { ...frame, mobileDeviceId: deviceId }
        fromMobiles.push(stamped)
        desktop?.send(JSON.stringify(stamped))
      }
    })
  })
  const port = (server.address() as { port: number }).port
  return { server, url: `ws://127.0.0.1:${port}`, fromMobiles, inject: (frame: unknown) => desktop?.send(JSON.stringify(frame)) }
}

describe('RemoteControlService phone channel over the relay', () => {
  const domains: Array<() => void> = []
  let service: RemoteControlService | null = null
  let relay: Awaited<ReturnType<typeof startRelay>> | null = null
  const clients: RelayClient[] = []

  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect()
    await service?.stop()
    service = null
    relay?.server.close()
    relay = null
    while (domains.length) domains.pop()!()
  })

  async function start(phones: Array<Omit<PairedPhone, 'enabled'> & { enabled?: boolean }>, domain?: DesktopDomain) {
    domain ??= phoneDomain(domains).domain
    relay = await startRelay()
    const paired = new Map(phones.map((phone) => [phone.keyId, { enabled: true, ...phone }]))
    service = new RemoteControlService(relay.url, {
      hostInfo: () => ({ appVersion: '0.73.0-alpha.1', protocol: 3, environmentId: domain!.identity.environmentId }),
      openPhoneConnection: (link: Parameters<typeof openPhoneConnection>[1]) => openPhoneConnection(domain!, link),
      pairedPhones: {
        byKey: (keyId) => paired.get(keyId) ?? null,
        byId: (id) => [...paired.values()].find((phone) => phone.deviceId === id) ?? null,
      },
    })
    await service.start({ enabled: true, masterSecret: ROOT, deviceId: 'desktop', relayUrl: relay.url, channelScheme: 2 })
    await vi.waitFor(() => expect(service!.isRelayConnected()).toBe(true))
    return paired
  }

  function phone(deviceId: string, keyId: string): { client: RelayClient; controls: unknown[]; events: unknown[][]; connect: () => Promise<void> } {
    const controls: unknown[] = []
    const events: unknown[][] = []
    const client = new RelayClient({ onControl: (frame) => controls.push(frame), onEvents: (batch) => events.push(batch) })
    clients.push(client)
    const link: HostLink = { credential: issueChannelCredential(ROOT, keyId), roomId: '0f'.repeat(16) }
    return { client, controls, events, connect: () => client.connectRelay({ relayUrl: relay!.url, link, deviceId }) }
  }

  it('serves the native endpoint through the real relay sender and sealed phone channel', async () => {
    const { domain, own } = phoneDomain(domains)
    await start([{ deviceId: 'native', deviceName: 'Phone', keyId: 'native-key' }], domain)
    const a = phone('native', 'native-key'); await a.connect(); await a.client.verifyHost()
    const resource = { environmentId: domain.identity.environmentId, sessionId: 'own' }
    await a.client.acquireControl(resource)
    await a.client.controlledRpc(resource, 'session.send', { text: 'native relay', clientMessageId: 'native' })
    expect(own.sent).toContainEqual(expect.objectContaining({ content: 'native relay' }))
    expect(JSON.stringify(relay!.fromMobiles)).not.toContain('native relay')
    await a.client.releaseControl(resource)
  })

  it('runs both handshakes through the relay and follows native session events', async () => {
    const { domain, own, projectDir } = phoneDomain(domains)
    await start([{ deviceId: 'dev-1', deviceName: 'iPhone', keyId: 'key-dev-1' }], domain)
    const a = phone('dev-1', 'key-dev-1')
    await a.connect()
    await a.client.verifyHost()
    const loaded = await a.client.rpc<SessionLoadResult>('session.load', { sessionId: 'own' })
    await a.client.followSession({ session: { environmentId: domain.identity.environmentId, sessionId: 'own' }, projectPath: projectDir, cursor: loaded.cursor })
    expect(a.controls).toContainEqual(expect.objectContaining({ type: 'handshake' }))
    expect(service!.getOnlineDevices().get('dev-1')).toEqual({ name: 'iPhone', transport: 'relay' })

    own.emitHostEvent({ type: 'status_change', status: 'error' })
    await vi.waitFor(() => expect(a.events.flat()).toContainEqual(expect.objectContaining({ type: 'status_change', status: 'error', environmentId: domain.identity.environmentId })))
    // Nothing secret or readable crossed the relay.
    const wire = JSON.stringify(relay!.fromMobiles)
    expect(wire).not.toContain(issueChannelCredential(ROOT, 'key-dev-1').secretHex)
    expect(wire).not.toContain('session.load')
  })

  it('does not admit a native mutation the relay replays', async () => {
    const { domain, own } = phoneDomain(domains)
    await start([{ deviceId: 'dev-1', deviceName: 'iPhone', keyId: 'key-dev-1' }], domain)
    const a = phone('dev-1', 'key-dev-1')
    await a.connect()
    const resource = { environmentId: domain.identity.environmentId, sessionId: 'own' }
    await a.client.acquireControl(resource)
    await a.client.controlledRpc(resource, 'session.send', { text: 'once', clientMessageId: 'once' })
    expect(own.sent).toHaveLength(1)
    relay!.inject(relay!.fromMobiles.filter((frame) => frame.type === 'command').at(-1))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(own.sent).toHaveLength(1)
  })

  it('kicks a key presented from another device slot, and a revoked device', async () => {
    const paired = await start([
      { deviceId: 'dev-1', deviceName: 'iPhone', keyId: 'key-dev-1' },
      { deviceId: 'dev-2', deviceName: 'Pixel', keyId: 'key-dev-2' },
    ])
    const thief = phone('dev-2', 'key-dev-1')
    await thief.connect()
    await vi.waitFor(() => expect(thief.controls).toContainEqual(expect.objectContaining({ type: 'kicked' })))
    expect(service!.getOnlineDevices().has('dev-2')).toBe(false)

    const b = phone('dev-2', 'key-dev-2')
    await b.connect()
    await b.client.verifyHost()
    await vi.waitFor(() => expect(service!.getOnlineDevices().has('dev-2')).toBe(true))
    paired.delete('key-dev-2')
    service!.revokeDevice('dev-2')
    await vi.waitFor(() => expect(b.controls).toContainEqual(expect.objectContaining({ type: 'kicked' })))
    expect(service!.getOnlineDevices().has('dev-2')).toBe(false)

    const again = phone('dev-2', 'key-dev-2')
    await again.connect()
    await vi.waitFor(() => expect(again.controls).toContainEqual(expect.objectContaining({ type: 'kicked' })))
    await expect(again.client.rpc('project.list', {}, { timeoutMs: 300 })).rejects.toThrow()
  })

  describe('removing a device mid-handshake', () => {
    /** A raw phone in its relay slot that has said hello and holds the challenge, but not yet proven its key. */
    async function challenged(deviceId: string, keyId: string) {
      const socket = new WebSocket(`${relay!.url}/?role=mobile&deviceId=${deviceId}`)
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
      const hs = startClientHandshake(issueChannelCredential(ROOT, keyId))
      const challenge = nextFrame(socket, (f) => f.type === 'channel')
      socket.send(JSON.stringify({ type: 'channel', msg: hs.hello }))
      const { proof, channel } = hs.finish((await challenge).msg)
      const frames: Array<Record<string, unknown>> = []
      socket.on('message', (raw) => frames.push(JSON.parse(raw.toString())))
      return {
        socket,
        frames,
        proveAndCommand: () => {
          socket.send(JSON.stringify({ type: 'channel', msg: proof }))
          const data = sealLinkFrame(channel, { t: 'rpc' }, encodePlainMessage({ type: 'handshake', requestId: 'r1', payload: { protocol: { current: 3, min: 3, max: 3 }, databaseSchema: { current: 1, min: 1, max: 1 } } }))
          socket.send(JSON.stringify({ type: 'command', data }))
        },
      }
    }

    it('revoking the device cancels its pending relay handshake', async () => {
      const paired = await start([{ deviceId: 'dev-1', deviceName: 'iPhone', keyId: 'key-dev-1' }])
      const phone = await challenged('dev-1', 'key-dev-1')
      paired.delete('key-dev-1')
      service!.revokeDevice('dev-1')
      phone.proveAndCommand()
      await vi.waitFor(() => expect(phone.frames).toContainEqual(expect.objectContaining({ type: 'kicked', mobileDeviceId: 'dev-1' })))
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(phone.frames.some((f) => f.type === 'channel' && 'data' in f)).toBe(false)
      expect(service!.getOnlineDevices().has('dev-1')).toBe(false)
      phone.socket.close()
    })

    it('rejects a proof that arrives after the pairing was deleted', async () => {
      const paired = await start([{ deviceId: 'dev-1', deviceName: 'iPhone', keyId: 'key-dev-1' }])
      const phone = await challenged('dev-1', 'key-dev-1')
      paired.delete('key-dev-1')
      phone.proveAndCommand()
      await vi.waitFor(() => expect(phone.frames).toContainEqual(expect.objectContaining({ type: 'kicked', mobileDeviceId: 'dev-1' })))
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(service!.getOnlineDevices().has('dev-1')).toBe(false)
      phone.socket.close()
    })

    it('refuses a command on an open channel once the pairing is gone', async () => {
      const paired = await start([{ deviceId: 'dev-1', deviceName: 'iPhone', keyId: 'key-dev-1' }])
      const a = phone('dev-1', 'key-dev-1')
      await a.connect()
      await a.client.verifyHost()
      await vi.waitFor(() => expect(service!.getOnlineDevices().has('dev-1')).toBe(true))
      paired.delete('key-dev-1')
      await expect(a.client.rpc('environment.health', {}, { timeoutMs: 300 })).rejects.toThrow()
      await vi.waitFor(() => expect(a.controls).toContainEqual(expect.objectContaining({ type: 'kicked' })))
      expect(service!.getOnlineDevices().has('dev-1')).toBe(false)
    })
  })
})
