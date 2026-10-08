import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelayClient, type SocketLike } from './client'
import { restoreSession } from './restore'
import { LINK_CHANNEL_FRAME } from './phone-link'
import { issueChannelCredential } from './secure-channel'
import { TEST_LINK, TEST_ROOT_SECRET, completeHandshake } from './test-host-link'

const RELAY = { relayUrl: 'wss://relay.example', link: TEST_LINK, deviceId: 'dev-1' }

class MockSocket implements SocketLike {
  sent: string[] = []
  closed = false
  onopen: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.closed = true
    this.onclose?.()
  }
  emit(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) })
  }
}

afterEach(() => vi.useRealTimers())

it('probes a healthy foreground socket once and resolves false when it closes', async () => {
  const socket = new MockSocket()
  const client = new RelayClient({ openSocket: () => { queueMicrotask(() => socket.onopen?.()); return socket } })
  await client.connectRelay(RELAY)
  const probe = client.probeConnection()
  expect(client.probeConnection()).toBe(probe)
  // The relay's auto-response pair is the literal text, as the heartbeat uses.
  expect(socket.sent.at(-1)).toBe('ping')
  socket.onmessage?.({ data: 'pong' })
  await expect(probe).resolves.toBe(true)
  const lost = client.probeConnection()
  client.disconnect()
  await expect(lost).resolves.toBe(false)
})

describe('RelayClient', () => {
  it('connects, requests RPC, and applies buffered events after restore', async () => {
    let sock: MockSocket | null = null
    const events: unknown[][] = []
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
      onEvents: (batch) => events.push(batch),
    })
    await client.connectRelay(RELAY)
    expect(sock).not.toBeNull()
    // Nothing sealed for an earlier connection can be opened, so nothing is replayed.
    expect(sock!.sent.some((s) => s.includes('"replay"'))).toBe(false)
    const reqP = client.request({ type: 'list_projects', requestId: 'r1' })
    // Commands wait for the channel; nothing goes out in the clear before it.
    await Promise.resolve()
    expect(sock!.sent.some((s) => s.includes('"command"'))).toBe(false)
    const host = completeHandshake(sock!)

    client.startBuffering()
    sock!.emit({ type: 'event', seq: 1, data: host.seal('event', { type: 'status_change', status: 'idle' }) })
    expect(events).toEqual([])

    await vi.waitFor(() => expect(sock!.sent.some((s) => s.includes('"command"'))).toBe(true))
    expect(host.reply(sock!, { projects: [{ path: '/p', name: 'p' }] })).toMatchObject({ type: 'list_projects', requestId: 'r1' })
    await expect(reqP).resolves.toEqual({ projects: [{ path: '/p', name: 'p' }] })

    const released = client.releaseBuffer()
    expect(released.epoch).toBe(1)
    expect(released.batches).toHaveLength(1)
  })

  it('runs the channel handshake, re-runs it for a rejoining desktop, and surfaces control frames', async () => {
    let sock: MockSocket | null = null
    const controls: unknown[] = []
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
      onControl: (frame) => controls.push(frame),
    })

    await client.connectRelay(RELAY)
    const hello = JSON.parse(sock!.sent[0]!)
    expect(hello).toMatchObject({ type: LINK_CHANNEL_FRAME, msg: { type: 'channel_hello', keyId: TEST_LINK.credential.keyId } })
    // The secret never appears on the wire.
    expect(sock!.sent.join('')).not.toContain(TEST_LINK.credential.secretHex)
    completeHandshake(sock!, TEST_LINK, 'desktop')
    sock!.emit({ type: 'peer_disconnected' })
    sock!.emit({ type: 'peer_connected' })
    const hellos = sock!.sent.filter((s) => s.includes('channel_hello'))
    expect(hellos).toHaveLength(2)
    completeHandshake(sock!, TEST_LINK, 'desktop')
    expect(controls).toEqual([
      { type: 'handshake', hostName: 'desktop' },
      { type: 'peer_disconnected' },
      { type: 'peer_connected' },
      { type: 'handshake', hostName: 'desktop' },
    ])
  })

  it('ignores a challenge for an older hello and drops a host that cannot prove the secret', async () => {
    let sock: MockSocket | null = null
    const statuses: boolean[] = []
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
      onStatus: (connected) => statuses.push(connected),
    })
    await client.connectRelay(RELAY)
    sock!.emit({ type: LINK_CHANNEL_FRAME, msg: { type: 'channel_challenge', v: 1, nonce: 'aa'.repeat(32), proof: 'bb'.repeat(32) }, hello: 'stale' })
    expect(sock!.sent.some((s) => s.includes('channel_proof'))).toBe(false)
    const impostor = { credential: issueChannelCredential(TEST_ROOT_SECRET, 'test-phone-key-x'), roomId: TEST_LINK.roomId }
    expect(() => completeHandshake(sock!, { ...impostor, credential: { ...impostor.credential, keyId: TEST_LINK.credential.keyId } })).toThrow('no channel proof sent')
    expect(statuses).toEqual([true, false])
  })

  it('restoreSession is subscribe → history → snapshot → release', async () => {
    let sock: MockSocket | null = null
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
    })
    await client.connectRelay(RELAY)
    const host = completeHandshake(sock!)
    const restoreP = restoreSession(client, '/proj', 'sess-1')
    let answered = 0
    const reply = async (body: unknown) => {
      await vi.waitFor(() => expect(sock!.sent.filter((s) => s.includes('"command"')).length).toBeGreaterThan(answered))
      answered += 1
      host.reply(sock!, body)
    }
    await reply({ ok: true })
    await reply({ messages: [{ id: 'm1', role: 'user', status: 'complete', content: [], createdAt: '', providerId: 'claude' }], hasMore: false, cursor: null })
    await reply({ status: 'idle', pendingInteractions: [], inProgressMessages: [] })
    const restored = await restoreP
    expect(restored.messages).toHaveLength(1)
    expect(restored.snapshot.status).toBe('idle')
  })

  it('send() is fire-and-forget and delivers terminal frames', async () => {
    let sock: MockSocket | null = null
    const terms: unknown[] = []
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
      onTerminal: (p) => terms.push(p),
    })
    await client.connectRelay(RELAY)
    const host = completeHandshake(sock!)
    await Promise.resolve()
    const before = sock!.sent.length
    client.send({ type: 'terminal_input', terminalId: 't1', data: 'ls\n' })
    expect(sock!.sent.length).toBe(before + 1)
    expect(host.lastCommand(sock!)).toEqual({ type: 'terminal_input', terminalId: 't1', data: 'ls\n' })
    sock!.emit({ type: 'terminal', data: host.seal('terminal', { type: 'terminal_output', data: 'ok' }) })
    expect(terms).toEqual([{ type: 'terminal_output', data: 'ok' }])
  })

  it('delivers every event the channel opens, whatever its envelope seq, and never ACKs or asks for replay', async () => {
    vi.useFakeTimers()
    let sock: MockSocket | null = null
    let delivered = 0
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
      onEvents: () => { delivered += 1 },
    })
    const connected = client.connectRelay(RELAY)
    await vi.runAllTicks()
    await connected
    const host = completeHandshake(sock!)
    // A phone shares the relay with others, so its envelope seqs can skip; the
    // channel, not the envelope, decides what is new.
    const total = 2_200
    for (let i = 0; i < total; i++) sock!.emit({ type: 'event', seq: 1 + i * 2, data: host.seal('event', { type: 'e', i }) })
    sock!.emit({ type: 'event', seq: 1, data: 'invalid-ciphertext' })
    vi.advanceTimersByTime(10_000)
    expect(delivered).toBe(total)
    expect(sock!.sent.some((frame) => frame.includes('"ack"') || frame.includes('"replay"'))).toBe(false)
  })

  it('buffers events after a reconnect, on a fresh channel, with one exclusive socket', async () => {
    const sockets: MockSocket[] = []
    const client = new RelayClient({
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })
    await client.connectRelay(RELAY)
    const first = completeHandshake(sockets[0])
    const stale = first.seal('event', { type: 'sealed-for-the-old-connection' })
    await client.reconnect()
    expect(sockets).toHaveLength(2)
    expect(sockets[0].closed).toBe(true)
    expect(client.buffer.isBuffering).toBe(true)

    const host = completeHandshake(sockets[1])
    sockets[1].emit({ type: 'event', seq: 7, data: stale })
    sockets[1].emit({
      type: 'event',
      seq: 8,
      data: host.seal('event', { type: 'during-replay' }),
    })
    client.startBuffering()
    expect(client.releaseBuffer().batches).toEqual([[{ type: 'during-replay' }]])
  })

  it('does not emit a false status while opening a replacement socket', async () => {
    const statuses: boolean[] = []
    const sockets: MockSocket[] = []
    const client = new RelayClient({
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
      onStatus: (connected) => statuses.push(connected),
    })
    await client.connectRelay(RELAY)
    await client.reconnect()
    expect(statuses).toEqual([true, true])
    expect(sockets[0].closed).toBe(true)
  })

  it('keeps relay and LAN delivery exclusive', async () => {
    const sockets: MockSocket[] = []
    const events: unknown[][] = []
    const client = new RelayClient({
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
      onEvents: (batch) => events.push(batch),
    })
    await client.connectRelay(RELAY)
    await client.connectLan('192.0.2.1', 7788, TEST_LINK)
    expect(sockets).toHaveLength(2)
    expect(sockets[0].closed).toBe(true)
    expect(client.transport).toBe('lan')

    const host = completeHandshake(sockets[1])
    sockets[1].emit({
      type: 'event',
      seq: 42,
      data: host.seal('event', [{ type: 'lan-event' }]),
    })
    expect(events).toEqual([[{ type: 'lan-event' }]])
  })

  it('downloads a desktop file over LAN by resolving {lanHost} to the connected host', async () => {
    const client = new RelayClient({
      openSocket: () => {
        const socket = new MockSocket()
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })
    await client.connectLan('192.0.2.1', 7788, TEST_LINK)

    const bytes = new TextEncoder().encode('png')
    const get = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
    }))
    await expect(client.downloadDesktopFile({
      ok: true,
      url: 'http://{lanHost}:7788/files/token',
      name: 'shot.png',
      mimeType: 'image/png',
      size: bytes.byteLength,
      modifiedAt: 1,
      expiresAt: Date.now() + 60_000,
    }, get)).resolves.toEqual(bytes)
    expect(get).toHaveBeenCalledWith('http://192.0.2.1:7788/files/token')
  })

  it('rejects an RPC response that cannot be decrypted', async () => {
    let sock: MockSocket | null = null
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
    })
    await client.connectRelay(RELAY)
    const host = completeHandshake(sock!)
    const result = client.request({ type: 'list_projects', requestId: 'bad-response' })
    await vi.waitFor(() => expect(sock!.sent.some((s) => s.includes('"command"'))).toBe(true))
    sock!.emit({ type: 'response', requestId: 'bad-response', data: 'invalid' })
    await expect(result).rejects.toBeInstanceOf(Error)
  })

  it('rejects a replayed frame and an event relabelled as a response', async () => {
    let sock: MockSocket | null = null
    const events: unknown[][] = []
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
      onEvents: (batch) => events.push(batch),
    })
    await client.connectRelay(RELAY)
    const host = completeHandshake(sock!)
    const once = host.seal('event', { type: 'once' })
    sock!.emit({ type: 'event', data: once })
    sock!.emit({ type: 'event', data: once })
    expect(events).toEqual([[{ type: 'once' }]])

    const result = client.request({ type: 'list_projects', requestId: 'r-relabel' })
    await vi.waitFor(() => expect(sock!.sent.some((s) => s.includes('"command"'))).toBe(true))
    sock!.emit({ type: 'response', requestId: 'r-relabel', data: host.seal('event', { projects: [] }) })
    await expect(result).rejects.toThrow('link frame kind event')
  })
})
