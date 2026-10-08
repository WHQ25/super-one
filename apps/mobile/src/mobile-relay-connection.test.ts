import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SocketLike } from '@superone/relay-client'
import { createMobileRelayConnection } from './mobile-relay-connection'
import { TEST_LINK, completeHandshake } from '../../../packages/relay-client/src/test-host-link'

const ENDPOINT = { relayUrl: 'wss://relay.example', link: TEST_LINK, identity: { deviceId: 'phone-1', deviceName: 'Phone' } }

class MockSocket implements SocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  /** The relay answers heartbeat pings itself, so a parked mailbox socket stays alive. */
  send(data: string): void {
    this.sent.push(data)
    if (data === 'ping') queueMicrotask(() => this.onmessage?.({ data: 'pong' }))
  }
  close(): void {}
  drop(): void { this.onclose?.() }
  emit(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }) }
}

afterEach(() => vi.useRealTimers())

describe('mobile relay connection lifecycle', () => {
  it('delivers events and terminal traffic to adopted hooks after link preparation', async () => {
    const oldEvents = vi.fn(), newEvents = vi.fn(), oldTerminal = vi.fn(), newTerminal = vi.fn()
    const socket = new MockSocket()
    const hooks = { onEvents: oldEvents, onTerminal: oldTerminal, restore: vi.fn().mockResolvedValue(1), currentEpoch: () => 1, onConnection: vi.fn(), onStatus: vi.fn(), onShutdown: vi.fn(), suppressDisconnect: () => false, endpoint: ENDPOINT, resolveLan: async () => null, openSocket: () => { queueMicrotask(() => socket.onopen?.()); return socket } }
    const connection = createMobileRelayConnection(hooks)
    await connection.dial(null)
    connection.client.releaseBuffer()
    connection.adoptHooks({ ...hooks, onEvents: newEvents, onTerminal: newTerminal })
    const host = completeHandshake(socket)
    socket.emit({ type: 'event', seq: 1, data: host.seal('event', { type: 'status_change', sessionId: 'same', status: 'idle' }) })
    socket.emit({ type: 'terminal', data: host.seal('terminal', { type: 'output', text: 'ready' }) })
    expect(newEvents).toHaveBeenCalledOnce()
    expect(newTerminal).toHaveBeenCalledOnce()
    expect(oldEvents).not.toHaveBeenCalled()
    expect(oldTerminal).not.toHaveBeenCalled()
    connection.client.disconnect()
  })
  it('shows workspace consumers a batch that a session restore is holding back', async () => {
    const onEvents = vi.fn(), onArrived = vi.fn()
    const socket = new MockSocket()
    const connection = createMobileRelayConnection({ onEvents, onArrived, onTerminal: vi.fn(), restore: vi.fn().mockResolvedValue(1), currentEpoch: () => 1, onConnection: vi.fn(), onStatus: vi.fn(), onShutdown: vi.fn(), suppressDisconnect: () => false, endpoint: ENDPOINT, resolveLan: async () => null, openSocket: () => { queueMicrotask(() => socket.onopen?.()); return socket } })
    await connection.dial(null)
    const host = completeHandshake(socket)
    connection.client.startBuffering()
    const changed = { type: 'session_list_changed', projectPath: '/repo' }
    socket.emit({ type: 'event', seq: 1, data: host.seal('event', changed) })
    expect(onArrived).toHaveBeenCalledWith([changed])
    expect(onEvents).not.toHaveBeenCalled()
    expect(connection.client.releaseBuffer().batches).toEqual([[changed]])
    connection.client.disconnect()
  })
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
      endpoint: ENDPOINT,
      resolveLan: async () => null,
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.dial(null)
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
      endpoint: ENDPOINT,
      resolveLan: async () => null,
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.dial(null)
    sockets[0].emit({ type: 'peer_disconnected' })
    expect(onConnection).toHaveBeenLastCalledWith('offline', 2)
    sockets[0].emit({ type: 'peer_connected' })
    // An existing relay replay reset can arrive before the peer's handshake.
    sockets[0].emit({ type: 'reset' })
    completeHandshake(sockets[0], TEST_LINK, 'desktop')
    await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1))
    expect(sockets).toHaveLength(1)
    expect(onConnection).toHaveBeenLastCalledWith('connected', 3)
    expect(onStatus).toHaveBeenLastCalledWith('')
    expect(onShutdown).not.toHaveBeenCalled()
    expect(connection.client.connected).toBe(true)
    connection.client.disconnect()
  })

  it('rehydrates when the desktop redials before the relay saw its old socket close', async () => {
    const sockets: MockSocket[] = []
    const restore = vi.fn().mockResolvedValue(3)
    const onConnection = vi.fn()
    const connection = createMobileRelayConnection({
      onEvents: vi.fn(),
      onTerminal: vi.fn(),
      restore,
      currentEpoch: () => 2,
      onConnection,
      onStatus: vi.fn(),
      onShutdown: vi.fn(),
      suppressDisconnect: () => false,
      endpoint: ENDPOINT,
      resolveLan: async () => null,
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.dial(null)
    // No `peer_disconnected` first: the replaced desktop socket closed silently.
    sockets[0].emit({ type: 'peer_connected' })
    expect(onConnection).toHaveBeenLastCalledWith('reconnecting', 2)
    completeHandshake(sockets[0], TEST_LINK, 'desktop')
    await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1))
    expect(onConnection).toHaveBeenLastCalledWith('connected', 3)
    expect(sockets).toHaveLength(1)
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
      endpoint: ENDPOINT,
      resolveLan: async () => null,
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.dial(null)
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
      endpoint: ENDPOINT,
      resolveLan: async () => null,
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.dial(null)
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
    completeHandshake(sockets[1], TEST_LINK, 'desktop')
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
      endpoint: ENDPOINT,
      resolveLan: async () => null,
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.dial(null)
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(isDesktopOnline).toHaveBeenCalledTimes(1)

    // The desktop answers our attach before the relay's presence probe returns
    // — the probe sampled a heartbeat timestamp the redial has since superseded.
    completeHandshake(sockets[1], TEST_LINK, 'desktop')
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
      endpoint: ENDPOINT,
      resolveLan: async () => ({ host: '192.168.1.2', port: 7788 }),
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
    })

    await connection.dial({ host: '192.168.1.2', port: 7788 })
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(isDesktopOnline).not.toHaveBeenCalled()
    expect(restore).toHaveBeenCalledTimes(1)
    expect(onConnection).toHaveBeenLastCalledWith('connected', 2)
  })

  it('redials the route discovery resolves now, not the LAN address it first connected on', async () => {
    vi.useFakeTimers()
    const urls: string[] = []
    const sockets: MockSocket[] = []
    const restore = vi.fn().mockResolvedValue(3)
    const onConnection = vi.fn()
    const resolveLan = vi.fn(async () => null)
    const connection = createMobileRelayConnection({
      onEvents: vi.fn(),
      onTerminal: vi.fn(),
      restore,
      currentEpoch: () => 1,
      onConnection,
      onStatus: vi.fn(),
      onShutdown: vi.fn(),
      isDesktopOnline: vi.fn().mockResolvedValue(true),
      suppressDisconnect: () => false,
      endpoint: ENDPOINT,
      resolveLan,
      openSocket: (url) => {
        urls.push(url)
        const socket = new MockSocket()
        sockets.push(socket)
        // The address the phone first dialled no longer answers.
        queueMicrotask(() => (url.includes(':7788') && sockets.length > 1 ? socket.onerror?.() : socket.onopen?.()))
        return socket
      },
    })

    await connection.dial({ host: '192.168.1.2', port: 7788 })
    sockets[0].drop()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(resolveLan).toHaveBeenCalledTimes(1)
    expect(urls).toHaveLength(2)
    expect(urls[1].startsWith('wss://relay.example/ws?role=mobile')).toBe(true)
    expect(connection.client.transport).toBe('relay')
    expect(restore).toHaveBeenCalledTimes(1)
    expect(onConnection).toHaveBeenLastCalledWith('connected', 3)
  })

  it('asks for the route again on every retry and follows the desktop to its new LAN port', async () => {
    vi.useFakeTimers()
    const urls: string[] = []
    const restore = vi.fn().mockResolvedValue(4)
    const onConnection = vi.fn()
    const resolveLan = vi.fn()
      .mockResolvedValueOnce({ host: '192.168.1.2', port: 7788 })
      .mockResolvedValue({ host: '192.168.1.2', port: 9001 })
    let first!: MockSocket
    const connection = createMobileRelayConnection({
      onEvents: vi.fn(),
      onTerminal: vi.fn(),
      restore,
      currentEpoch: () => 1,
      onConnection,
      onStatus: vi.fn(),
      onShutdown: vi.fn(),
      suppressDisconnect: () => false,
      endpoint: ENDPOINT,
      resolveLan,
      openSocket: (url) => {
        urls.push(url)
        const socket = new MockSocket()
        first ??= socket
        queueMicrotask(() => (url.includes(':7788') && urls.length > 1 ? socket.onerror?.() : socket.onopen?.()))
        return socket
      },
    })

    await connection.dial({ host: '192.168.1.2', port: 7788 })
    first.drop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(urls.at(-1)).toBe('ws://192.168.1.2:7788/ws')
    expect(restore).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2_000)
    expect(resolveLan).toHaveBeenCalledTimes(2)
    expect(urls.at(-1)).toBe('ws://192.168.1.2:9001/ws')
    expect(onConnection).toHaveBeenLastCalledWith('connected', 4)
  })
})
