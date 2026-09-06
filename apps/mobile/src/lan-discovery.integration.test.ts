import { describe, expect, it, vi } from 'vitest'
import { roomIdForSecret, type SavedPairing } from '@superone/relay-client'
import { DeviceDiscovery } from './device-discovery'
import { LanServiceCache, type NativeLanRecord } from './lan-service-cache'
import { deriveDeviceStatus } from './device-status'

/**
 * The seam mDNS exists for: an advertised record has to be matched back to a
 * saved pairing, and the only thing linking them is a room id each side derives
 * independently from the shared secret. This exercises that with the real
 * derivation rather than a stub, because a mismatch here is invisible in unit
 * tests — discovery simply never matches anything and every device reads offline.
 *
 * The record shape mirrors what the desktop publishes in
 * `remote-control-service.ts#startLanAdvertiser`: TXT `roomId`, `hostName`, `variant`.
 * Verified against a live desktop on 2026-09-06 (see README.preview.md).
 */

const SECRET = '7f'.repeat(32)
const OTHER_SECRET = '3a'.repeat(32)
const HOST = '192.168.1.9'
const PORT = 51_549

function advertisement(secret: string, over: Partial<NativeLanRecord> = {}): NativeLanRecord {
  return {
    host: 'desk.local',
    addresses: [HOST],
    port: PORT,
    txt: { roomId: roomIdForSecret(secret), hostName: 'Studio iMac', variant: 'alpha' },
    ...over,
  }
}

function pairing(secret: string): SavedPairing {
  return { id: 'desk-1', relayUrl: 'wss://relay.example.com', secret }
}

function harness(records: NativeLanRecord[]) {
  const cache = new LanServiceCache()
  cache.replace(records)
  const checkLan = vi.fn(async (host: string, port: number) => host === HOST && port === PORT)
  const discovery = new DeviceDiscovery({
    roomIdFor: roomIdForSecret,
    lanAddressOf: () => null,
    checkRelay: async () => false,
    checkLan,
    ensureBrowsing: async () => {},
    lookupLan: (roomId) => cache.lookup(roomId),
  }, () => {})
  return { cache, checkLan, discovery }
}

function statusOf(discovery: DeviceDiscovery, item: SavedPairing) {
  return deriveDeviceStatus({
    pairingId: item.id,
    activePairingId: null,
    activeTransport: null,
    connectionState: 'offline',
    connectingPairingId: null,
    reachability: discovery.reachabilityOf(item.id),
    searchingLan: false,
  })
}

describe('matching an advertised desktop to a saved pairing', () => {
  it('turns a saved pairing online over LAN when its room is advertised', async () => {
    const item = pairing(SECRET)
    const { discovery, checkLan } = harness([advertisement(SECRET)])
    discovery.setPairings([item])
    await discovery.refresh({ reset: true })
    expect(checkLan).toHaveBeenCalledExactlyOnceWith(HOST, PORT)
    expect(statusOf(discovery, item)).toBe('onlineLan')
    expect(discovery.lanAddressOf(item.id)).toEqual({ host: HOST, port: PORT })
  })

  it('ignores a desktop advertising a different room', async () => {
    const item = pairing(SECRET)
    const { discovery, checkLan } = harness([advertisement(OTHER_SECRET)])
    discovery.setPairings([item])
    await discovery.refresh({ reset: true })
    expect(checkLan).not.toHaveBeenCalled()
    expect(statusOf(discovery, item)).toBe('offline')
  })

  it('stays offline when the room is advertised but nothing answers there', async () => {
    const item = pairing(SECRET)
    const { discovery } = harness([advertisement(SECRET, { addresses: ['10.0.0.99'] })])
    discovery.setPairings([item])
    await discovery.refresh({ reset: true })
    expect(statusOf(discovery, item)).toBe('offline')
    expect(discovery.lanAddressOf(item.id)).toBeNull()
  })

  it('follows the desktop to a new address when it re-advertises', async () => {
    const item = pairing(SECRET)
    const { cache, discovery } = harness([advertisement(SECRET, { addresses: ['10.0.0.99'] })])
    discovery.setPairings([item])
    await discovery.refresh({ reset: true })
    expect(statusOf(discovery, item)).toBe('offline')

    cache.replace([advertisement(SECRET)])
    await discovery.refresh({ reset: true })
    expect(statusOf(discovery, item)).toBe('onlineLan')
    expect(discovery.lanAddressOf(item.id)).toEqual({ host: HOST, port: PORT })
  })

  it('drops back offline once the desktop stops advertising', async () => {
    const item = pairing(SECRET)
    const { cache, discovery } = harness([advertisement(SECRET)])
    discovery.setPairings([item])
    await discovery.refresh({ reset: true })
    expect(statusOf(discovery, item)).toBe('onlineLan')

    cache.clear()
    await discovery.refresh({ reset: true })
    expect(statusOf(discovery, item)).toBe('offline')
  })

  it('matches each pairing to its own room when several desktops advertise', async () => {
    const mine = pairing(SECRET)
    const theirs = { ...pairing(OTHER_SECRET), id: 'desk-2' }
    const { discovery } = harness([
      advertisement(OTHER_SECRET, { addresses: ['10.0.0.99'], port: 9_101 }),
      advertisement(SECRET),
    ])
    discovery.setPairings([mine, theirs])
    await discovery.refresh({ reset: true })
    expect(statusOf(discovery, mine)).toBe('onlineLan')
    expect(statusOf(discovery, theirs)).toBe('offline')
  })
})
