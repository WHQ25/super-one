import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'

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
import { issueChannelCredential } from '@superone/relay-client/secure-channel'
import { RemoteControlService, type PairedPhone } from './remote-control-service'

const ROOT = 'ab'.repeat(32)

/** The relay's routing contract (apps/relay `relay-session.ts`), minus buffering. */
async function startRelay() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  let desktop: ServerSocket | null = null
  const mobiles = new Map<string, ServerSocket>()
  const fromMobiles: Array<Record<string, unknown>> = []
  let seq = 0
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
        if (frame.type === 'event') for (const id of frame.targets as string[]) to(id)?.send(JSON.stringify({ type: 'event', seq: ++seq, data: frame.data }))
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
  let service: RemoteControlService | null = null
  let relay: Awaited<ReturnType<typeof startRelay>> | null = null
  const clients: RelayClient[] = []

  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect()
    await service?.stop()
    service = null
    relay?.server.close()
    relay = null
  })

  async function start(phones: PairedPhone[], onCommand = vi.fn()) {
    relay = await startRelay()
    const paired = new Map(phones.map((phone) => [phone.keyId, phone]))
    service = new RemoteControlService(relay.url, {
      onCommand,
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

  it('runs the handshake through the relay, answers a command and delivers events', async () => {
    const onCommand = vi.fn((cmd: { requestId?: string }, respond: (id: string, data: unknown) => Promise<void>) => {
      if (cmd.requestId) void respond(cmd.requestId, { ok: true })
    })
    await start([{ deviceId: 'dev-1', deviceName: 'iPhone', keyId: 'key-dev-1' }], onCommand)
    const a = phone('dev-1', 'key-dev-1')
    await a.connect()
    await expect(a.client.request({ type: 'list_projects', requestId: 'r1' } as never)).resolves.toEqual({ ok: true })
    expect(onCommand.mock.calls[0]?.[2]).toEqual({ deviceId: 'dev-1', transport: 'relay' })
    expect(a.controls).toContainEqual(expect.objectContaining({ type: 'handshake' }))
    expect(service!.getOnlineDevices().get('dev-1')).toEqual({ name: 'iPhone', transport: 'relay' })

    await service!.sendEventToMobile({ type: 'status_change', status: 'idle' }, ['dev-1'])
    await vi.waitFor(() => expect(a.events).toEqual([[{ type: 'status_change', status: 'idle' }]]))
    // Nothing secret or readable crossed the relay.
    const wire = JSON.stringify(relay!.fromMobiles)
    expect(wire).not.toContain(issueChannelCredential(ROOT, 'key-dev-1').secretHex)
    expect(wire).not.toContain('list_projects')
  })

  it('ignores a command the relay replays', async () => {
    const onCommand = vi.fn()
    await start([{ deviceId: 'dev-1', deviceName: 'iPhone', keyId: 'key-dev-1' }], onCommand)
    const a = phone('dev-1', 'key-dev-1')
    await a.connect()
    a.client.send({ type: 'terminal_input', terminalId: 't', data: 'ls\n' } as never)
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledTimes(1))
    relay!.inject(relay!.fromMobiles.filter((frame) => frame.type === 'command').at(-1))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(onCommand).toHaveBeenCalledTimes(1)
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
    await vi.waitFor(() => expect(service!.getOnlineDevices().has('dev-2')).toBe(true))
    paired.delete('key-dev-2')
    service!.revokeDevice('dev-2')
    await vi.waitFor(() => expect(b.controls).toContainEqual(expect.objectContaining({ type: 'kicked' })))
    expect(service!.getOnlineDevices().has('dev-2')).toBe(false)

    const again = phone('dev-2', 'key-dev-2')
    await again.connect()
    await vi.waitFor(() => expect(again.controls).toContainEqual(expect.objectContaining({ type: 'kicked' })))
    await expect(again.client.request({ type: 'list_projects', requestId: 'r2' } as never, 300)).rejects.toThrow()
  })
})
