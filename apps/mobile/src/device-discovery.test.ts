import { describe, expect, it, vi } from 'vitest'
import type { SavedPairing } from '@superone/relay-client'
import { DeviceDiscovery, type DiscoveryPorts, type LanService } from './device-discovery'

function pairing(id: string, extra: Partial<SavedPairing> = {}): SavedPairing {
  return { id, relayUrl: 'wss://relay.example.com', secret: `secret-${id}`, ...extra }
}

function harness(overrides: Partial<DiscoveryPorts> = {}) {
  const services = new Map<string, LanService>()
  const ports: DiscoveryPorts = {
    roomIdFor: (secret) => `room-${secret}`,
    lanAddressOf: (item) => (item.lan ? { host: item.lan.split(':')[0], port: Number(item.lan.split(':')[1]) } : null),
    checkRelay: vi.fn(async () => false),
    checkLan: vi.fn(async () => false),
    ensureBrowsing: vi.fn(async () => {}),
    lookupLan: (roomId) => services.get(roomId) ?? null,
    ...overrides,
  }
  const onChange = vi.fn()
  return { ports, services, onChange, discovery: new DeviceDiscovery(ports, onChange) }
}

describe('device discovery refresh', () => {
  it('records the relay answer for every saved device', async () => {
    const { ports, discovery } = harness({
      checkRelay: vi.fn(async (item: SavedPairing) => item.id === 'desk-1'),
    })
    discovery.setPairings([pairing('desk-1'), pairing('desk-2')])
    await discovery.refresh({ reset: true })
    expect(discovery.reachabilityOf('desk-1')).toEqual({ lan: false, relay: true })
    expect(discovery.reachabilityOf('desk-2')).toEqual({ lan: false, relay: false })
    expect(ports.checkRelay).toHaveBeenCalledTimes(2)
  })

  it('probes the mDNS address over the one stored at pairing time', async () => {
    const checkLan = vi.fn(async () => true)
    const { discovery, services } = harness({ checkLan })
    services.set('room-secret-desk-1', { roomId: 'room-secret-desk-1', host: '10.0.0.5', port: 9000 })
    discovery.setPairings([pairing('desk-1', { lan: '192.168.1.9:8123' })])
    await discovery.refresh({ reset: true })
    expect(checkLan).toHaveBeenCalledExactlyOnceWith('10.0.0.5', 9000)
    expect(discovery.lanAddressOf('desk-1')).toEqual({ host: '10.0.0.5', port: 9000 })
  })

  it('falls back to the stored address when nothing is advertising', async () => {
    const checkLan = vi.fn(async () => true)
    const { discovery } = harness({ checkLan })
    discovery.setPairings([pairing('desk-1', { lan: '192.168.1.9:8123' })])
    await discovery.refresh({ reset: true })
    expect(checkLan).toHaveBeenCalledExactlyOnceWith('192.168.1.9', 8123)
  })

  it('does not remember an address that failed to answer', async () => {
    const { discovery } = harness({ checkLan: vi.fn(async () => false) })
    discovery.setPairings([pairing('desk-1', { lan: '192.168.1.9:8123' })])
    await discovery.refresh({ reset: true })
    expect(discovery.lanAddressOf('desk-1')).toBeNull()
    expect(discovery.reachabilityOf('desk-1').lan).toBe(false)
  })

  it('skips the LAN probe entirely when no address is known', async () => {
    const checkLan = vi.fn(async () => true)
    const { discovery } = harness({ checkLan })
    discovery.setPairings([pairing('desk-1')])
    await discovery.refresh({ reset: true })
    expect(checkLan).not.toHaveBeenCalled()
  })

  it('ignores a second refresh while one is still running', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const checkRelay = vi.fn(async () => { await gate; return true })
    const { discovery } = harness({ checkRelay })
    discovery.setPairings([pairing('desk-1')])
    const first = discovery.refresh({ reset: true })
    await discovery.refresh({ reset: true })
    expect(checkRelay).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(discovery.isRefreshing).toBe(false)
  })

  it('does nothing at all when there are no saved devices', async () => {
    const { discovery, ports, onChange } = harness()
    await discovery.refresh({ reset: true })
    expect(ports.ensureBrowsing).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clears prior results on a reset refresh so a stale route cannot linger', async () => {
    const checkRelay = vi.fn(async () => true)
    const { discovery, ports } = harness({ checkRelay })
    discovery.setPairings([pairing('desk-1')])
    await discovery.refresh({ reset: true })
    expect(discovery.reachabilityOf('desk-1').relay).toBe(true)

    let seenDuringRefresh: boolean | null = null
    ;(ports.checkRelay as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      seenDuringRefresh = discovery.reachabilityOf('desk-1').relay
      return false
    })
    await discovery.refresh({ reset: true })
    expect(seenDuringRefresh).toBe(false)
  })

  it('keeps prior results on an incremental refresh', async () => {
    const { discovery, ports } = harness({ checkRelay: vi.fn(async () => true) })
    discovery.setPairings([pairing('desk-1')])
    await discovery.refresh({ reset: true })

    let seenDuringRefresh: boolean | null = null
    ;(ports.checkRelay as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      seenDuringRefresh = discovery.reachabilityOf('desk-1').relay
      return true
    })
    await discovery.refresh({ reset: false })
    expect(seenDuringRefresh).toBe(true)
  })
})

describe('device discovery notifications', () => {
  it('notifies once per actual change, not once per probe', async () => {
    const { discovery, onChange } = harness({ checkRelay: vi.fn(async () => false) })
    discovery.setPairings([pairing('desk-1')])
    await discovery.refresh({ reset: true })
    // Start and finish of the refresh only: nothing became reachable.
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('notifies when a device becomes reachable', async () => {
    const { discovery, onChange } = harness({ checkRelay: vi.fn(async () => true) })
    discovery.setPairings([pairing('desk-1')])
    await discovery.refresh({ reset: true })
    expect(onChange).toHaveBeenCalledTimes(3)
  })
})

describe('mDNS cache updates', () => {
  it('probes a device that only just started advertising', async () => {
    const checkLan = vi.fn(async () => true)
    const { discovery, services } = harness({ checkLan })
    discovery.setPairings([pairing('desk-1')])
    await discovery.refresh({ reset: true })
    expect(checkLan).not.toHaveBeenCalled()

    services.set('room-secret-desk-1', { roomId: 'room-secret-desk-1', host: '10.0.0.5', port: 9000 })
    discovery.handleLanCacheUpdated()
    await vi.waitFor(() => expect(discovery.reachabilityOf('desk-1').lan).toBe(true))
    expect(checkLan).toHaveBeenCalledExactlyOnceWith('10.0.0.5', 9000)
  })

  it('does not re-probe a device already known to be on the LAN', async () => {
    const checkLan = vi.fn(async () => true)
    const { discovery, services } = harness({ checkLan })
    services.set('room-secret-desk-1', { roomId: 'room-secret-desk-1', host: '10.0.0.5', port: 9000 })
    discovery.setPairings([pairing('desk-1')])
    await discovery.refresh({ reset: true })
    discovery.handleLanCacheUpdated()
    expect(checkLan).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent probes of the same address into one request', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const checkLan = vi.fn(async () => { await gate; return true })
    const { discovery, services } = harness({ checkLan })
    services.set('room-secret-desk-1', { roomId: 'room-secret-desk-1', host: '10.0.0.5', port: 9000 })
    discovery.setPairings([pairing('desk-1')])
    discovery.handleLanCacheUpdated()
    discovery.handleLanCacheUpdated()
    expect(checkLan).toHaveBeenCalledTimes(1)
    release()
    await vi.waitFor(() => expect(discovery.reachabilityOf('desk-1').lan).toBe(true))
  })
})

describe('forgetting a device', () => {
  it('drops everything known about a pairing that is no longer saved', async () => {
    const { discovery, services } = harness({
      checkRelay: vi.fn(async () => true),
      checkLan: vi.fn(async () => true),
    })
    services.set('room-secret-desk-1', { roomId: 'room-secret-desk-1', host: '10.0.0.5', port: 9000 })
    discovery.setPairings([pairing('desk-1')])
    await discovery.refresh({ reset: true })
    expect(discovery.reachabilityOf('desk-1')).toEqual({ lan: true, relay: true })

    discovery.setPairings([])
    expect(discovery.reachabilityOf('desk-1')).toEqual({ lan: false, relay: false })
    expect(discovery.lanAddressOf('desk-1')).toBeNull()
  })
})
