import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SocketLike } from '@superone/relay-client'
import { createMobileRelayConnection } from './mobile-relay-connection'

const MASTER = '0123456789abcdef'.repeat(8)

class MockSocket implements SocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  /** The relay answers heartbeat pings itself, so a parked mailbox socket stays alive. */
  send(data: string): void {
    if (data === 'ping') queueMicrotask(() => this.onmessage?.({ data: 'pong' }))
  }
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
    const onShutdown = vi.fn()
    const connection = createMobileRelayConnection({
      onEvents: vi.fn(),
      onTerminal: vi.fn(),
      restore,
      currentEpoch: () => 2,
      onConnection,
      onStatus,
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
    sockets[0].emit({ type: 'peer_disconnected' })
    expect(onConnection).toHaveBeenLastCalledWith('offline', 2)
    sockets[0].emit({ type: 'peer_connected' })
    // An existing relay replay reset can arrive before the peer's handshake.
    sockets[0].emit({ type: 'reset' })
    sockets[0].emit({ type: 'handshake', hostName: 'desktop' })
    await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1))
    expect(sockets).toHaveLength(1)
    expect(onConnection).toHaveBeenLastCalledWith('connected', 3)
    expect(onStatus).toHaveBeenLastCalledWith('')
    expect(onShutdown).not.toHaveBeenCalled()
    expect(connection.client.connected).toBe(true)
    connection.client.disconnect()
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

  it('parks a reopened relay socket as offline when the desktop is away, then restores on its handshake', async () => {
    vi.useFakeTimers()
    const sockets: MockSocket[] = []
    const restore = vi.fn().mockResolvedValue(5)
    const isDesktopOnline = vi.fn().mockResolvedValue(false)
    const onConnection = vi.fn()
    const onReconnectInfo = vi.fn()
    const connection = createMobileRelayConnection({
      onEvents: vi.fn(),
      onTerminal: vi.fn(),
      restore,
      currentEpoch: () => 4,
      onConnection,
      onStatus: vi.fn(),
      onReconnectInfo,
      onShutdown: vi.fn(),
      isDesktopOnline,
      suppressDisconnect: () => false,
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    sockets[0].drop()
    expect(onConnection).toHaveBeenLastCalledWith('reconnecting', 4)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(2)
    expect(isDesktopOnline).toHaveBeenCalledTimes(1)
    expect(restore).not.toHaveBeenCalled()
    expect(onConnection).toHaveBeenLastCalledWith('offline', 4)
    expect(onReconnectInfo).toHaveBeenLastCalledWith({ attempting: false, waiting: false, delayMs: 0, nextAtMs: null })
    expect(connection.reconnectController.isActive).toBe(false)
    expect(connection.client.connected).toBe(true)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets).toHaveLength(2)

    sockets[1].emit({ type: 'peer_connected' })
    sockets[1].emit({ type: 'handshake', hostName: 'desktop' })
    await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1))
    expect(onConnection).toHaveBeenLastCalledWith('connected', 5)
  })

  it('trusts a handshake that lands while a stale /status probe is still in flight', async () => {
    vi.useFakeTimers()
    const sockets: MockSocket[] = []
    const restore = vi.fn().mockResolvedValue(7)
    let answerProbe!: (online: boolean) => void
    const isDesktopOnline = vi.fn(() => new Promise<boolean>((resolve) => { answerProbe = resolve }))
    const onConnection = vi.fn()
    const connection = createMobileRelayConnection({
      onEvents: vi.fn(),
      onTerminal: vi.fn(),
      restore,
      currentEpoch: () => 6,
      onConnection,
      onStatus: vi.fn(),
      onShutdown: vi.fn(),
      isDesktopOnline,
      suppressDisconnect: () => false,
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(isDesktopOnline).toHaveBeenCalledTimes(1)

    // The desktop answers our attach before the relay's presence probe returns
    // — the probe sampled a heartbeat timestamp the redial has since superseded.
    sockets[1].emit({ type: 'handshake', hostName: 'desktop' })
    answerProbe(false)
    await vi.runAllTicks()
    await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1))
    expect(onConnection).toHaveBeenLastCalledWith('connected', 7)
    expect(connection.reconnectController.isActive).toBe(false)
  })

  it('never probes the desktop over LAN, where the desktop is the socket peer', async () => {
    vi.useFakeTimers()
    const sockets: MockSocket[] = []
    const restore = vi.fn().mockResolvedValue(2)
    const isDesktopOnline = vi.fn().mockResolvedValue(false)
    const onConnection = vi.fn()
    const connection = createMobileRelayConnection({
      onEvents: vi.fn(),
      onTerminal: vi.fn(),
      restore,
      currentEpoch: () => 1,
      onConnection,
      onStatus: vi.fn(),
      onShutdown: vi.fn(),
      isDesktopOnline,
      suppressDisconnect: () => false,
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.client.connectLan('192.168.1.2', 7788, MASTER)
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(isDesktopOnline).not.toHaveBeenCalled()
    expect(restore).toHaveBeenCalledTimes(1)
    expect(onConnection).toHaveBeenLastCalledWith('connected', 2)
  })
})
