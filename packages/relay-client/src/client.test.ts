import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveKeys, encryptPayload } from './crypto'
import { RelayClient, type SocketLike } from './client'
import { restoreSession } from './restore'

const MASTER = '0123456789abcdef'.repeat(8)

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
    await client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER, deviceId: 'd1' })
    expect(sock).not.toBeNull()
    expect(sock!.sent.some((s) => s.includes('"replay"'))).toBe(true)

    client.startBuffering()
    const keys = deriveKeys(MASTER)
    const live = encryptPayload(keys.aesKeyBytes, { type: 'status_change', status: 'idle' })
    sock!.emit({ type: 'event', seq: 1, data: live })
    expect(events).toEqual([])

    const reqP = client.request({ type: 'list_projects', requestId: 'r1' })
    const cmd = JSON.parse(sock!.sent.find((s) => s.includes('"command"'))!)
    const payload = encryptPayload(keys.aesKeyBytes, { projects: [{ path: '/p', name: 'p' }] })
    sock!.emit({ type: 'response', requestId: 'r1', data: payload })
    await expect(reqP).resolves.toEqual({ projects: [{ path: '/p', name: 'p' }] })

    const released = client.releaseBuffer()
    expect(released.epoch).toBe(1)
    expect(released.batches).toHaveLength(1)
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
    await client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    const keys = deriveKeys(MASTER)
    const restoreP = restoreSession(client, '/proj', 'sess-1')
    await Promise.resolve()
    const reply = async (body: unknown) => {
      const last = sock!.sent.filter((s) => s.includes('"command"')).at(-1)!
      const frame = JSON.parse(last) as { data: string }
      const cmd = (await import('./crypto')).decryptPayload(keys.aesKeyBytes, frame.data) as { requestId: string }
      sock!.emit({ type: 'response', requestId: cmd.requestId, data: encryptPayload(keys.aesKeyBytes, body) })
    }
    await reply({ ok: true })
    await reply({ messages: [{ id: 'm1', role: 'user', status: 'complete', content: [], createdAt: '', providerId: 'claude' }], hasMore: false, cursor: null })
    await reply({ status: 'idle', pendingInteractions: [], inProgressMessages: [] })
    const restored = await restoreP
    expect(restored.messages).toHaveLength(1)
    expect(restored.snapshot.status).toBe('idle')
  })

  it('send() is fire-and-forget and onTerminal skips ACK', async () => {
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
    await client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    const before = sock!.sent.length
    client.send({ type: 'terminal_input', terminalId: 't1', data: 'ls\n' })
    expect(sock!.sent.length).toBe(before + 1)
    expect(sock!.sent.at(-1)).toContain('"command"')
    const keys = deriveKeys(MASTER)
    sock!.emit({ type: 'terminal', data: encryptPayload(keys.aesKeyBytes, { type: 'terminal_output', data: 'ok' }) })
    expect(terms).toEqual([{ type: 'terminal_output', data: 'ok' }])
  })

  it('keeps a terminal flood outside the event ACK namespace', async () => {
    vi.useFakeTimers()
    let sock: MockSocket | null = null
    let terminalFrames = 0
    const events: unknown[][] = []
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
      onTerminal: () => { terminalFrames += 1 },
      onEvents: (batch) => events.push(batch),
    })
    const connected = client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    await vi.runAllTicks()
    await connected
    const { aesKeyBytes } = deriveKeys(MASTER)
    const terminalData = encryptPayload(aesKeyBytes, {
      type: 'terminal_output',
      terminalId: 't1',
      data: 'x'.repeat(8 * 1_024),
    })
    for (let i = 0; i < 384; i++) {
      sock!.emit({ type: 'terminal', seq: i + 1, data: terminalData })
    }
    expect(terminalFrames).toBe(384)
    expect(client.lastAckedSeq).toBe(0)
    expect(sock!.sent.some((frame) => frame.includes('"ack"'))).toBe(false)

    sock!.emit({
      type: 'event',
      seq: 1,
      data: encryptPayload(aesKeyBytes, { type: 'after-terminal-flood' }),
    })
    expect(events).toEqual([[{ type: 'after-terminal-flood' }]])
    vi.advanceTimersByTime(2_000)
    expect(sock!.sent.filter((frame) => frame.includes('"ack"'))).toEqual([
      JSON.stringify({ type: 'ack', seq: 1 }),
    ])
  })

  it('keeps one ACK timer and sends its latest cumulative watermark', async () => {
    vi.useFakeTimers()
    let sock: MockSocket | null = null
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
    })
    const connected = client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    await vi.runAllTicks()
    await connected
    const keys = deriveKeys(MASTER)
    const payload = (seq: number) => encryptPayload(keys.aesKeyBytes, { type: 'event', eventSeq: seq })
    sock!.emit({ type: 'event', seq: 1, data: payload(1) })
    vi.advanceTimersByTime(1_000)
    sock!.emit({ type: 'event', seq: 2, data: payload(2) })
    vi.advanceTimersByTime(999)
    expect(sock!.sent.filter((frame) => frame.includes('"ack"'))).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(sock!.sent.filter((frame) => frame.includes('"ack"'))).toEqual([
      JSON.stringify({ type: 'ack', seq: 2 }),
    ])

    for (let seq = 3; seq <= 11; seq++) sock!.emit({ type: 'event', seq, data: payload(seq) })
    expect(sock!.sent.filter((frame) => frame.includes('"ack"'))).toHaveLength(1)
    sock!.emit({ type: 'event', seq: 12, data: payload(12) })
    expect(sock!.sent.filter((frame) => frame.includes('"ack"')).at(-1)).toBe(
      JSON.stringify({ type: 'ack', seq: 12 }),
    )
  })

  it('cancels stale ACKs when reset arrives', async () => {
    vi.useFakeTimers()
    let sock: MockSocket | null = null
    const resets: number[] = []
    let client: RelayClient
    client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
      onReset: () => {
        resets.push(1)
        client.send({ type: 'subscribe_session', projectPath: '/p', sessionId: 's' })
      },
    })
    const connected = client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    await vi.runAllTicks()
    await connected
    const { aesKeyBytes } = deriveKeys(MASTER)
    sock!.emit({ type: 'event', seq: 1, data: encryptPayload(aesKeyBytes, { type: 'one' }) })
    const sentBeforeReset = sock!.sent.length
    sock!.emit({ type: 'reset' })
    vi.advanceTimersByTime(2_000)
    expect(sock!.sent.filter((frame) => frame.includes('"ack"'))).toHaveLength(0)
    expect(resets).toEqual([1])
    expect(client.buffer.isBuffering).toBe(true)
    expect(sock!.sent).toHaveLength(sentBeforeReset + 1)
  })

  it('ACKs a relay envelope even when payload decryption fails', async () => {
    vi.useFakeTimers()
    let sock: MockSocket | null = null
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
    })
    const connected = client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    await vi.runAllTicks()
    await connected
    sock!.emit({ type: 'event', seq: 1, data: 'invalid-ciphertext' })
    vi.advanceTimersByTime(2_000)
    expect(sock!.sent.filter((frame) => frame.includes('"ack"'))).toEqual([
      JSON.stringify({ type: 'ack', seq: 1 }),
    ])
  })

  it('buffers replay before reconnect and keeps one exclusive socket', async () => {
    const sockets: MockSocket[] = []
    const client = new RelayClient({
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })
    await client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    await client.reconnect()
    expect(sockets).toHaveLength(2)
    expect(sockets[0].closed).toBe(true)
    expect(client.buffer.isBuffering).toBe(true)

    const { aesKeyBytes } = deriveKeys(MASTER)
    sockets[1].emit({
      type: 'event',
      seq: 1,
      data: encryptPayload(aesKeyBytes, { type: 'during-replay' }),
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
    await client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    await client.reconnect()
    expect(statuses).toEqual([true, true])
    expect(sockets[0].closed).toBe(true)
  })

  it('keeps relay and LAN delivery exclusive and never ACKs a LAN seq', async () => {
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
    await client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    await client.connectLan('192.0.2.1', 7788, MASTER)
    expect(sockets).toHaveLength(2)
    expect(sockets[0].closed).toBe(true)
    expect(client.transport).toBe('lan')

    const { aesKeyBytes } = deriveKeys(MASTER)
    sockets[1].emit({
      type: 'event',
      seq: 42,
      data: encryptPayload(aesKeyBytes, [{ type: 'lan-event' }]),
    })
    expect(events).toEqual([[{ type: 'lan-event' }]])
    expect(sockets[1].sent.some((frame) => frame.includes('"ack"'))).toBe(false)
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
    await client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    const result = client.request({ type: 'list_projects', requestId: 'bad-response' })
    sock!.emit({ type: 'response', requestId: 'bad-response', data: 'invalid' })
    await expect(result).rejects.toBeInstanceOf(Error)
  })
})
