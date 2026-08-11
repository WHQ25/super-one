import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { sockets, MockWebSocket } = vi.hoisted(() => {
  const OPEN = 1
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('node:events') as typeof import('node:events')
  const sockets: Array<
    InstanceType<typeof EventEmitter> & {
      readyState: number
      send: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
      url: string
    }
  > = []

  class MockWebSocket extends EventEmitter {
    static OPEN = OPEN
    readyState = 0
    send = vi.fn()
    close = vi.fn(() => {
      this.readyState = 3
    })
    constructor(
      public url: string,
      _opts?: { headers?: Record<string, string> },
    ) {
      super()
      sockets.push(this as (typeof sockets)[number])
      queueMicrotask(() => {
        this.readyState = OPEN
        this.emit('open')
      })
    }
  }

  return { sockets, MockWebSocket }
})

vi.mock('ws', () => ({ default: MockWebSocket }))

import { NodeRpcClient } from './node-rpc-client'

function lastSocket() {
  const ws = sockets[sockets.length - 1]
  if (!ws) throw new Error('no socket')
  return ws
}

function generateEd25519Pem(): string {
  const { privateKey } = generateKeyPairSync('ed25519')
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
}

async function connectClient(opts: {
  supervised?: boolean
  onUnexpectedDisconnect?: (error: string) => void
  heartbeatIntervalMs?: number
}) {
  const client = new NodeRpcClient({
    baseUrl: 'http://127.0.0.1:7788',
    devicePrivateKeyPem: generateEd25519Pem(),
    getWsTicket: async () => 'ticket.abc',
    expectedEnvironmentId: 'env-1',
    supervised: opts.supervised,
    onUnexpectedDisconnect: opts.onUnexpectedDisconnect,
    heartbeatIntervalMs: opts.heartbeatIntervalMs,
  })
  const connectPromise = client.connect()
  await new Promise((r) => setTimeout(r, 0))
  const ws = lastSocket()
  const sent = ws.send.mock.calls[0]?.[0] as string
  const hs = JSON.parse(sent) as { requestId: string }
  ws.emit(
    'message',
    Buffer.from(JSON.stringify({ type: 'handshake_ok', requestId: hs.requestId })),
  )
  await connectPromise
  return { client, ws }
}

/** Frames the client pushed on the socket, excluding the handshake. */
function sentFrames(ws: ReturnType<typeof lastSocket>): Array<{ type?: string; requestId?: string }> {
  return ws.send.mock.calls
    .map((c) => JSON.parse(c[0] as string) as { type?: string; requestId?: string })
    .filter((m) => m.type !== 'handshake')
}

describe('NodeRpcClient disconnect signaling', () => {
  afterEach(() => {
    sockets.length = 0
    vi.clearAllMocks()
  })

  it('emits onUnexpectedDisconnect once when the promoted socket closes', async () => {
    const onUnexpectedDisconnect = vi.fn()
    const { client, ws } = await connectClient({
      supervised: true,
      onUnexpectedDisconnect,
    })
    expect(client.connected).toBe(true)
    ws.emit('close')
    expect(onUnexpectedDisconnect).toHaveBeenCalledTimes(1)
    expect(onUnexpectedDisconnect).toHaveBeenCalledWith('websocket closed')
    expect(client.connected).toBe(false)
  })

  it('does not emit on explicit close()', async () => {
    const onUnexpectedDisconnect = vi.fn()
    const { client } = await connectClient({
      supervised: true,
      onUnexpectedDisconnect,
    })
    client.close()
    expect(onUnexpectedDisconnect).not.toHaveBeenCalled()
  })

  it('supervised rpc does not self-dial after close', async () => {
    const { client, ws } = await connectClient({ supervised: true })
    ws.emit('close')
    await expect(client.rpc('environment.health')).rejects.toMatchObject({
      message: expect.stringMatching(/not connected|websocket closed/),
    })
    expect(sockets).toHaveLength(1)
  })

  it('setBaseUrl updates the target while idle', () => {
    const client = new NodeRpcClient({
      baseUrl: 'http://127.0.0.1:1111',
      devicePrivateKeyPem: generateEd25519Pem(),
      getWsTicket: async () => 'ticket.abc',
    })
    client.setBaseUrl('http://127.0.0.1:2222/')
    expect(client.getBaseUrl()).toBe('http://127.0.0.1:2222')
  })

  it('setBaseUrl throws while connected', async () => {
    const { client } = await connectClient({})
    expect(() => client.setBaseUrl('http://127.0.0.1:3333')).toThrow(/setBaseUrl/)
    client.close()
  })

  it('invalidateTransport drops the socket without firing unexpected disconnect', async () => {
    const onUnexpectedDisconnect = vi.fn()
    const { client, ws } = await connectClient({
      supervised: true,
      onUnexpectedDisconnect,
    })
    expect(client.connected).toBe(true)
    client.invalidateTransport('probe failed')
    expect(client.connected).toBe(false)
    expect(onUnexpectedDisconnect).not.toHaveBeenCalled()
    // After invalidate, setBaseUrl is allowed again.
    client.setBaseUrl('http://127.0.0.1:9999')
    expect(client.getBaseUrl()).toBe('http://127.0.0.1:9999')
    // Stale close event must not fire after listeners removed.
    ws.emit('close')
    expect(onUnexpectedDisconnect).not.toHaveBeenCalled()
    client.close()
  })
})

/**
 * An SSH-forwarded socket can die without ever emitting 'close' (the tunnel is
 * gone but readyState stays OPEN). Without these signals the supervisor stays in
 * `connected` forever and every send silently times out.
 */
describe('NodeRpcClient half-open transport detection', () => {
  afterEach(() => {
    sockets.length = 0
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('reports the transport dead when an rpc times out on the live socket', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onUnexpectedDisconnect = vi.fn()
    const { client } = await connectClient({ supervised: true, onUnexpectedDisconnect })
    expect(client.connected).toBe(true)

    // Server never answers — exactly what a dead tunnel looks like to the client.
    const pending = client.rpc('environment.health').catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(16_000)
    const err = (await pending) as Error

    expect(err.message).toMatch(/rpc timeout/)
    expect(onUnexpectedDisconnect).toHaveBeenCalledTimes(1)
    expect(client.connected).toBe(false)
  })

  it('does not report dead when a stale socket times out after replacement', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onUnexpectedDisconnect = vi.fn()
    const { client } = await connectClient({ supervised: true, onUnexpectedDisconnect })
    const pending = client.rpc('environment.health').catch((e: Error) => e)
    // Supervisor swaps the transport before the timeout lands.
    client.invalidateTransport('replaced')
    await vi.advanceTimersByTimeAsync(16_000)
    await pending
    expect(onUnexpectedDisconnect).not.toHaveBeenCalled()
  })

  it('sends periodic heartbeats while the socket is idle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { client, ws } = await connectClient({ supervised: true, heartbeatIntervalMs: 1_000 })

    await vi.advanceTimersByTimeAsync(1_000)
    const pings = sentFrames(ws).filter((m) => m.type === 'ping')
    expect(pings).toHaveLength(1)

    // Answering keeps the socket healthy across further ticks.
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'pong', requestId: pings[0]!.requestId })))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(client.connected).toBe(true)
    client.close()
  })

  it('declares the transport dead after consecutive unanswered heartbeats', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onUnexpectedDisconnect = vi.fn()
    const { client } = await connectClient({
      supervised: true,
      onUnexpectedDisconnect,
      heartbeatIntervalMs: 1_000,
    })

    // Tick 1 pings; ticks 2 and 3 find it unanswered — two misses is the ceiling.
    await vi.advanceTimersByTimeAsync(3_100)

    expect(onUnexpectedDisconnect).toHaveBeenCalledTimes(1)
    expect(onUnexpectedDisconnect.mock.calls[0]?.[0]).toMatch(/heartbeat/i)
    expect(client.connected).toBe(false)
  })

  it('stops heartbeats after close so a disposed client never fires disconnect', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onUnexpectedDisconnect = vi.fn()
    const { client } = await connectClient({
      supervised: true,
      onUnexpectedDisconnect,
      heartbeatIntervalMs: 1_000,
    })
    client.close()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(onUnexpectedDisconnect).not.toHaveBeenCalled()
  })
})
