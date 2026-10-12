import { describe, expect, it, vi } from 'vitest'
import type { RelayClient } from '@superone/relay-client'
import { retireMobileConnection } from './mobile-connection-lifecycle'
import { ReconnectController, type ConnectionState } from './reconnect-controller'

describe('retireMobileConnection', () => {
  it('clears ownership before closing and permanently fences the retained controller', () => {
    const reconnect = vi.fn(async () => {})
    const controller = new ReconnectController(reconnect, async () => 1, { onState: vi.fn() })
    const refs = {
      client: { current: null as RelayClient | null },
      controller: { current: controller as ReconnectController | null },
      connection: { current: { state: 'connected' as ConnectionState, epoch: 99 } },
      suppressReconnect: { current: false },
    }
    const disconnect = vi.fn(() => {
      expect(refs.client.current).toBeNull()
      expect(refs.controller.current).toBeNull()
      expect(refs.connection.current).toEqual({ state: 'offline', epoch: 0 })
      expect(refs.suppressReconnect.current).toBe(true)
      controller.force(99)
    })
    refs.client.current = { disconnect } as unknown as RelayClient

    retireMobileConnection(refs)
    retireMobileConnection(refs)

    expect(disconnect).toHaveBeenCalledOnce()
    expect(reconnect).not.toHaveBeenCalled()
    expect(controller.isActive).toBe(false)
    expect(refs.suppressReconnect.current).toBe(false)
  })

  it('retires a controller even when its transport was already lost', () => {
    const reconnect = vi.fn(async () => {})
    const controller = new ReconnectController(reconnect, async () => 1, { onState: vi.fn() })
    const refs = {
      client: { current: null }, controller: { current: controller as ReconnectController | null },
      connection: { current: { state: 'reconnecting' as ConnectionState, epoch: 4 } },
      suppressReconnect: { current: true },
    }
    retireMobileConnection(refs)
    controller.force(4)
    controller.start(4)
    expect(reconnect).not.toHaveBeenCalled()
    expect(refs.controller.current).toBeNull()
    expect(refs.suppressReconnect.current).toBe(true)
  })
})
