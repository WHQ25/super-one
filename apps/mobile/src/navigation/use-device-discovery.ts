import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import {
  checkLanReachable,
  checkRelayDesktopOnline,
  parseLanHostPort,
  roomIdForSecret,
  type SavedPairing,
} from '@superone/relay-client'
import { DeviceDiscovery, type LanAddress } from '../device-discovery'
import { LanBrowser } from '../lan-browser'
import { deriveDeviceStatus, type DeviceStatus } from '../device-status'

/**
 * Keeps the device list's reachability up to date: one long-lived Bonjour
 * browse plus a relay status probe per saved desktop, refreshed on mount, on
 * foreground, and whenever the user asks.
 */
export function useDeviceDiscovery(input: {
  pairings: SavedPairing[]
  activePairingId: string | null
  activeTransport: 'lan' | 'relay' | null
  connectionState: 'connected' | 'reconnecting' | 'offline'
  connectingPairingId: string | null
}): {
  refreshing: boolean
  refresh: (opts?: { reset?: boolean }) => Promise<void>
  statusOf: (pairing: SavedPairing) => DeviceStatus
  lanAddressOf: (pairingId: string) => LanAddress | null
} {
  const [, bumpRevision] = useState(0)
  const discoveryRef = useRef<DeviceDiscovery | null>(null)
  const browserRef = useRef<LanBrowser | null>(null)

  if (!discoveryRef.current) {
    const notify = () => bumpRevision((value) => value + 1)
    const browser = new LanBrowser(() => {
      discoveryRef.current?.handleLanCacheUpdated()
    })
    browserRef.current = browser
    discoveryRef.current = new DeviceDiscovery({
      roomIdFor: roomIdForSecret,
      lanAddressOf: (pairing) => parseLanHostPort(pairing.lan),
      checkRelay: (pairing) => checkRelayDesktopOnline({
        relayUrl: pairing.relayUrl,
        masterSecret: pairing.secret,
      }).catch(() => false),
      checkLan: (host, port) => checkLanReachable({ host, port }),
      ensureBrowsing: () => browser.ensureBrowsing(),
      lookupLan: (roomId) => browser.lookup(roomId),
    }, notify)
  }
  const discovery = discoveryRef.current

  const refresh = useCallback(
    (opts?: { reset?: boolean }) => discovery.refresh({ reset: opts?.reset ?? true }),
    [discovery],
  )

  const pairings = input.pairings
  useEffect(() => {
    discovery.setPairings(pairings)
  }, [discovery, pairings])

  // Keyed by identity, not array reference: renaming a device must not restart
  // discovery, while pairing or forgetting one must.
  const pairingKey = pairings.map((pairing) => pairing.id).join('|')
  useEffect(() => {
    if (pairingKey) void refresh({ reset: true })
  }, [pairingKey, refresh])

  useEffect(() => {
    let previous = AppState.currentState
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active') void refresh({ reset: true })
      previous = next
    })
    return () => subscription.remove()
  }, [refresh])

  useEffect(() => () => browserRef.current?.stop(), [])

  const statusOf = useCallback((pairing: SavedPairing): DeviceStatus => deriveDeviceStatus({
    pairingId: pairing.id,
    activePairingId: input.activePairingId,
    activeTransport: input.activeTransport,
    connectionState: input.connectionState,
    connectingPairingId: input.connectingPairingId,
    reachability: discovery.reachabilityOf(pairing.id),
    searchingLan: discovery.isRefreshing,
  }), [
    discovery,
    input.activePairingId,
    input.activeTransport,
    input.connectionState,
    input.connectingPairingId,
  ])

  return {
    refreshing: discovery.isRefreshing,
    refresh,
    statusOf,
    lanAddressOf: (pairingId) => discovery.lanAddressOf(pairingId),
  }
}
