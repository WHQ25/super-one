import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SocketLike } from '@superone/relay-client'
import { createMobileRelayConnection } from './mobile-relay-connection'

const MASTER = '0123456789abcdef'.repeat(8)

class MockSocket implements SocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send(): void {}
  close(): void {}
  drop(): void { this.onclose?.() }
  emit(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }) }
}

afterEach(() => vi.useRealTimers())

describe('mobile relay connection lifecycle', () => {
  it('does not report a reopened transport as connected before session restore', async () => {
    vi.useFakeTimers()
    const sockets: MockSocket[] = []
    let epoch = 1
    let finishRestore!: () => void
    const restore = vi.fn(() => new Promise<number>((resolve) => {
      finishRestore = () => resolve(++epoch)
    }))
    const onConnection = vi.fn()
    const connection = createMobileRelayConnection({
      onEvents: vi.fn(),
      onTerminal: vi.fn(),
      restore,
      currentEpoch: () => epoch,
      onConnection,
      onStatus: vi.fn(),
      onShutdown: vi.fn(),
      suppressDisconnect: () => false,
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    expect(onConnection).toHaveBeenLastCalledWith('connected', 1)

    sockets[0].drop()
    expect(onConnection).toHaveBeenLastCalledWith('reconnecting', 1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(2)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(onConnection).not.toHaveBeenCalledWith('connected', 2)

    finishRestore()
    await vi.runAllTicks()
    expect(onConnection).toHaveBeenLastCalledWith('connected', 2)
  })

  it('rehydrates when the desktop peer returns without replacing the relay socket', async () => {
    const sockets: MockSocket[] = []
    const restore = vi.fn().mockResolvedValue(3)
    const onConnection = vi.fn()
    const onStatus = vi.fn()
    const connection = createMobileRelayConnection({
      onEvents: vi.fn(),
      onTerminal: vi.fn(),
      restore,
      currentEpoch: () => 2,
      onConnection,
      onStatus,
      onShutdown: vi.fn(),
      suppressDisconnect: () => false,
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    sockets[0].emit({ type: 'peer_disconnected' })
    expect(onConnection).toHaveBeenLastCalledWith('reconnecting', 2)
    sockets[0].emit({ type: 'peer_connected' })
    sockets[0].emit({ type: 'handshake', hostName: 'desktop' })
    await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1))
    expect(sockets).toHaveLength(1)
    expect(onConnection).toHaveBeenLastCalledWith('connected', 3)
    expect(onStatus).toHaveBeenLastCalledWith('')
  })

  it('stops reconnecting when the desktop shuts down', async () => {
    const sockets: MockSocket[] = []
    const onShutdown = vi.fn()
    const connection = createMobileRelayConnection({
      onEvents: vi.fn(),
      onTerminal: vi.fn(),
      restore: vi.fn().mockResolvedValue(1),
      currentEpoch: () => 1,
      onConnection: vi.fn(),
      onStatus: vi.fn(),
      onShutdown,
      suppressDisconnect: () => false,
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    sockets[0].emit({ type: 'desktop_shutdown' })
    expect(onShutdown).toHaveBeenCalledOnce()
    expect(connection.client.connected).toBe(false)
    expect(connection.reconnectController.isActive).toBe(false)
  })
})
