import { describe, expect, it, vi } from 'vitest'
import {
  attachEnvironmentConnectivityMonitor,
  createNetworkChangeWatcher,
  createOnlineEdgeWatcher,
  networkAddressSignature,
} from './environment-connectivity-monitor'

describe('environment-connectivity-monitor', () => {
  it('starts desired connections on attach', async () => {
    const startDesiredConnections = vi.fn(async () => {})
    const wakeDesiredConnections = vi.fn(async () => {})
    const dispose = attachEnvironmentConnectivityMonitor({
      onResume: () => {},
      onOnlineEdge: () => () => {},
      startDesiredConnections,
      wakeDesiredConnections,
    })
    await Promise.resolve()
    expect(startDesiredConnections).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('fires wake on online edge', () => {
    let handler: (() => void) | null = null
    const wakeDesiredConnections = vi.fn(async () => {})
    attachEnvironmentConnectivityMonitor({
      onResume: () => {},
      onOnlineEdge: (h) => {
        handler = h
        return () => {
          handler = null
        }
      },
      startDesiredConnections: async () => {},
      wakeDesiredConnections,
    })
    handler?.()
    expect(wakeDesiredConnections).toHaveBeenCalledWith('network-online')
  })

  it('wakes on a network change that never went offline', () => {
    let handler: (() => void) | null = null
    const wakeDesiredConnections = vi.fn(async () => {})
    const dispose = attachEnvironmentConnectivityMonitor({
      onResume: () => {},
      onOnlineEdge: () => () => {},
      onNetworkChange: (h) => {
        handler = h
        return () => {
          handler = null
        }
      },
      startDesiredConnections: async () => {},
      wakeDesiredConnections,
    })
    handler?.()
    expect(wakeDesiredConnections).toHaveBeenCalledWith('network-online')
    dispose()
    expect(handler).toBeNull()
  })

  it('networkAddressSignature ignores loopback and interface order', () => {
    const a = networkAddressSignature({
      lo: [{ address: '127.0.0.1', internal: true }],
      en0: [{ address: '192.168.1.5', internal: false }],
      utun4: [{ address: '100.64.0.2', internal: false }],
    })
    const b = networkAddressSignature({
      utun4: [{ address: '100.64.0.2', internal: false }],
      en0: [{ address: '192.168.1.5', internal: false }],
    })
    expect(a).toBe(b)
    expect(a).not.toContain('127.0.0.1')
  })

  it('createNetworkChangeWatcher fires once after a change settles', () => {
    vi.useFakeTimers()
    try {
      let sig = 'wifi-a'
      const watcher = createNetworkChangeWatcher(() => sig, 100)
      const fired = vi.fn()
      watcher.onNetworkChange(fired)

      vi.advanceTimersByTime(300)
      expect(fired).not.toHaveBeenCalled()

      // Switch drops the old address, then the new one arrives.
      sig = ''
      vi.advanceTimersByTime(100)
      sig = 'wifi-b'
      vi.advanceTimersByTime(100)
      expect(fired).not.toHaveBeenCalled()
      vi.advanceTimersByTime(100)
      expect(fired).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(500)
      expect(fired).toHaveBeenCalledTimes(1)
      watcher.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('createOnlineEdgeWatcher detects false→true transitions', async () => {
    let online = false
    const watcher = createOnlineEdgeWatcher(() => online, 20)
    const seen: string[] = []
    watcher.onOnlineEdge(() => {
      seen.push('online')
    })
    online = true
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toEqual(['online'])
    // Stay online — no second fire.
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toEqual(['online'])
    watcher.stop()
  })
})
