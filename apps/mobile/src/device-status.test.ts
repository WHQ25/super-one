import { describe, expect, it } from 'vitest'
import {
  type DeviceReachability,
  type DeviceStatus,
  describeDeviceStatus,
  deriveDeviceStatus,
  isLanStatus,
  isReachable,
} from './device-status'

const base = {
  pairingId: 'desk-1',
  activePairingId: null,
  activeTransport: null,
  connectionState: 'offline',
  connectingPairingId: null,
  reachability: undefined,
  searchingLan: false,
} satisfies Parameters<typeof deriveDeviceStatus>[0]

const both: DeviceReachability = { lan: true, relay: true }

describe('device status derivation', () => {
  it('is offline when nothing has been discovered and no search is running', () => {
    expect(deriveDeviceStatus(base)).toBe('offline')
  })

  it('reports the local network search only while no route is known yet', () => {
    expect(deriveDeviceStatus({ ...base, searchingLan: true })).toBe('searchingLan')
    expect(deriveDeviceStatus({ ...base, searchingLan: true, reachability: { lan: false, relay: true } }))
      .toBe('onlineCloud')
  })

  it('prefers the LAN route over the cloud when both answer', () => {
    expect(deriveDeviceStatus({ ...base, reachability: both })).toBe('onlineLan')
  })

  it('names the transport of the socket it currently holds', () => {
    const connected = { ...base, activePairingId: 'desk-1', connectionState: 'connected' } as const
    expect(deriveDeviceStatus({ ...connected, activeTransport: 'lan' })).toBe('connectedLan')
    expect(deriveDeviceStatus({ ...connected, activeTransport: 'relay' })).toBe('connectedCloud')
  })

  it('outranks discovery with the live socket, so a stale probe cannot demote a connected device', () => {
    const status = deriveDeviceStatus({
      ...base,
      activePairingId: 'desk-1',
      activeTransport: 'lan',
      connectionState: 'connected',
      reachability: { lan: false, relay: false },
    })
    expect(status).toBe('connectedLan')
  })

  it('shows connecting for the device being dialled and for the active device that dropped', () => {
    expect(deriveDeviceStatus({ ...base, connectingPairingId: 'desk-1', reachability: both }))
      .toBe('connecting')
    expect(deriveDeviceStatus({
      ...base,
      activePairingId: 'desk-1',
      connectionState: 'reconnecting',
      reachability: both,
    })).toBe('connecting')
  })

  it('leaves other rows alone while one device is being dialled', () => {
    expect(deriveDeviceStatus({ ...base, connectingPairingId: 'desk-2', reachability: both }))
      .toBe('onlineLan')
  })
})

describe('device status presentation', () => {
  it('distinguishes LAN from cloud by glyph while sharing one label', () => {
    expect(describeDeviceStatus('onlineLan')).toMatchObject({ label: 'Online', glyph: 'wifi', tone: 'success' })
    expect(describeDeviceStatus('onlineCloud')).toMatchObject({ label: 'Online', glyph: 'cloud', tone: 'success' })
  })

  it('marks offline as the one danger tone in the list', () => {
    expect(describeDeviceStatus('offline')).toMatchObject({ label: 'Offline', tone: 'danger', glyph: 'cloud-off' })
  })

  it('spins only for the two in-progress states', () => {
    const spinning = ([
      'offline', 'searchingLan', 'onlineLan', 'onlineCloud', 'connecting', 'connectedLan', 'connectedCloud',
    ] as DeviceStatus[]).filter((status) => describeDeviceStatus(status).spin)
    expect(spinning).toEqual(['searchingLan', 'connecting'])
  })

  it('counts down to the next retry, rounding up and never below zero', () => {
    const reconnect = { attempting: false, waiting: true, delayMs: 4_000, nextAtMs: 10_500 }
    expect(describeDeviceStatus('connecting', { reconnect, nowMs: 8_000 }).label).toBe('Retrying in 3s')
    expect(describeDeviceStatus('connecting', { reconnect, nowMs: 20_000 }).label).toBe('Retrying in 0s')
  })

  it('says reconnecting while an attempt is in flight after a backoff', () => {
    const view = describeDeviceStatus('connecting', {
      reconnect: { attempting: true, waiting: false, delayMs: 2_000, nextAtMs: null },
      nowMs: 0,
    })
    expect(view.label).toBe('Reconnecting…')
  })

  it('falls back to connecting for a first attempt with no backoff yet', () => {
    const view = describeDeviceStatus('connecting', {
      reconnect: { attempting: true, waiting: false, delayMs: 0, nextAtMs: null },
      nowMs: 0,
    })
    expect(view).toMatchObject({ label: 'Connecting…', tone: 'foreground' })
  })

  it('turns the retry warning tone on once the backoff reaches eight seconds', () => {
    const at = (delayMs: number) => describeDeviceStatus('connecting', {
      reconnect: { attempting: true, waiting: false, delayMs, nextAtMs: null },
      nowMs: 0,
    }).tone
    expect([at(4_000), at(8_000), at(16_000)]).toEqual(['foreground', 'warning', 'warning'])
  })
})

describe('status predicates', () => {
  it('treats only settled routes as reachable', () => {
    expect(['onlineLan', 'onlineCloud', 'connectedLan', 'connectedCloud'].every(
      (status) => isReachable(status as DeviceStatus),
    )).toBe(true)
    expect(['offline', 'searchingLan', 'connecting'].some(
      (status) => isReachable(status as DeviceStatus),
    )).toBe(false)
  })

  it('identifies the two LAN-transport states', () => {
    expect(['onlineLan', 'connectedLan'].every((status) => isLanStatus(status as DeviceStatus))).toBe(true)
    expect(isLanStatus('onlineCloud')).toBe(false)
  })
})
