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
    await vi.advanceTimersByTimeAsync(1_200)
    expect(sockets).toHaveLength(2)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(onConnection).not.toHaveBeenCalledWith('connected', 2)

    finishRestore()
    await vi.runAllTicks()
    expect(onConnection).toHaveBeenLastCalledWith('connected', 2)
  })
})
