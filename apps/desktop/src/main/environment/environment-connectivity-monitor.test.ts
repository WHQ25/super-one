import { describe, expect, it, vi } from 'vitest'
import {
  attachEnvironmentConnectivityMonitor,
  createOnlineEdgeWatcher,
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
