import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RelayClient, type SocketLike } from './client'

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
  }
  /** The relay's auto-response is raw text, not a JSON frame. */
  pong(): void {
    this.onmessage?.({ data: 'pong' })
  }
}

function makeClient() {
  const sockets: MockSocket[] = []
  const statuses: boolean[] = []
  const client = new RelayClient({
    openSocket: () => {
      const sock = new MockSocket()
      sockets.push(sock)
      queueMicrotask(() => sock.onopen?.())
      return sock
    },
    onStatus: (connected) => statuses.push(connected),
    heartbeat: { intervalMs: 100, timeoutMs: 30 },
  })
  return { client, sockets, statuses }
}

const pings = (sock: MockSocket) => sock.sent.filter((s) => s === 'ping').length

describe('RelayClient heartbeat', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('pings the relay on a cadence and keeps the socket while pongs come back', async () => {
    const { client, sockets, statuses } = makeClient()
    await client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER, deviceId: 'd1' })
    const sock = sockets[0]!
    vi.advanceTimersByTime(100)
    expect(pings(sock)).toBe(1)
    sock.pong()
    vi.advanceTimersByTime(100)
    expect(pings(sock)).toBe(2)
    sock.pong()
    vi.advanceTimersByTime(50)
    expect(client.connected).toBe(true)
    expect(sock.closed).toBe(false)
    expect(statuses).toEqual([true])
  })

  it('treats a missed pong as a closed socket so the reconnect loop runs', async () => {
    const { client, sockets, statuses } = makeClient()
    await client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER, deviceId: 'd1' })
    const sock = sockets[0]!
    const pending = client.request({ type: 'list_projects', requestId: 'r1' } as never, 60_000)
    vi.advanceTimersByTime(130)
    expect(sock.closed).toBe(true)
    expect(client.connected).toBe(false)
    expect(statuses).toEqual([true, false])
    await expect(pending).rejects.toThrow('connection closed')
  })

  it('does not ping over LAN, where the desktop is the socket peer', async () => {
    const { client, sockets } = makeClient()
    await client.connectLan('10.0.0.2', 7788, MASTER, { deviceId: 'd1', deviceName: 'Phone' })
    vi.advanceTimersByTime(500)
    expect(pings(sockets[0]!)).toBe(0)
    expect(client.connected).toBe(true)
  })

  it('stops the heartbeat of a socket that was replaced or disconnected', async () => {
    const { client, sockets } = makeClient()
    await client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER, deviceId: 'd1' })
    await client.reconnect()
    const [first, second] = sockets as [MockSocket, MockSocket]
    vi.advanceTimersByTime(100)
    expect(pings(first)).toBe(0)
    expect(pings(second)).toBe(1)
    client.disconnect()
    vi.advanceTimersByTime(200)
    expect(pings(second)).toBe(1)
  })
})
