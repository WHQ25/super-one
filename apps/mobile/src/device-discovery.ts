import type { SavedPairing } from '@superone/relay-client'
import type { DeviceReachability } from './device-status'

export type LanService = { roomId: string; host: string; port: number; hostName?: string }

export type LanAddress = { host: string; port: number }

/**
 * Everything discovery needs from the outside world. Injected so the whole
 * orchestration is testable without a relay, a network, or a native browser.
 */
export type DiscoveryPorts = {
  roomIdFor: (secret: string) => string
  lanAddressOf: (pairing: SavedPairing) => LanAddress | null
  checkRelay: (pairing: SavedPairing) => Promise<boolean>
  checkLan: (host: string, port: number) => Promise<boolean>
  /** Keep the mDNS browser running; resolves once it is up (or gave up). */
  ensureBrowsing: () => Promise<void>
  /** Newest mDNS record for a room, or null when the desktop is not advertising. */
  lookupLan: (roomId: string) => LanService | null
}

const UNREACHABLE: DeviceReachability = { lan: false, relay: false }

function same(a: DeviceReachability, b: DeviceReachability): boolean {
  return a.lan === b.lan && a.relay === b.relay
}

/**
 * Owns what is known about every saved desktop's reachability, and the refresh
 * that finds it out. Two routes are probed independently — mDNS plus a direct
 * HTTP touch on the LAN, and the relay's room status — because either one alone
 * gives a wrong answer: the relay cannot see a desktop that is only on the LAN,
 * and mDNS cannot see a desktop that is somewhere else entirely.
 */
export class DeviceDiscovery {
  private reachability = new Map<string, DeviceReachability>()
  private addresses = new Map<string, LanAddress>()
  private pairings: SavedPairing[] = []
  private inFlightLanProbes = new Set<string>()
  private refreshing = false

  constructor(
    private readonly ports: DiscoveryPorts,
    private readonly onChange: () => void,
  ) {}

  get isRefreshing(): boolean {
    return this.refreshing
  }

  reachabilityOf(pairingId: string): DeviceReachability {
    return this.reachability.get(pairingId) ?? UNREACHABLE
  }

  /** The address a LAN connection should dial, once discovery has found one. */
  lanAddressOf(pairingId: string): LanAddress | null {
    return this.addresses.get(pairingId) ?? null
  }

  setPairings(pairings: SavedPairing[]): void {
    this.pairings = pairings
    const live = new Set(pairings.map((pairing) => pairing.id))
    for (const id of [...this.reachability.keys()]) {
      if (!live.has(id)) this.reachability.delete(id)
    }
    for (const id of [...this.addresses.keys()]) {
      if (!live.has(id)) this.addresses.delete(id)
    }
  }

  /**
   * `reset` clears what was known first, so a refresh the user asked for after
   * moving networks cannot keep showing a route that no longer exists. The
   * incremental refresh behind a device tap passes false to avoid flicker.
   */
  async refresh({ reset }: { reset: boolean }): Promise<void> {
    if (this.refreshing) return
    if (this.pairings.length === 0) return
    this.refreshing = true
    if (reset) {
      this.reachability.clear()
      this.addresses.clear()
    }
    this.onChange()
    const pairings = this.pairings
    try {
      await this.ports.ensureBrowsing()
      const lanProbes = this.probeKnownLanAddresses(pairings)
      const relayProbes = pairings.map(async (pairing) => {
        const online = await this.ports.checkRelay(pairing)
        this.apply(pairing.id, { relay: online })
      })
      await Promise.all([...lanProbes, ...relayProbes])
    } finally {
      this.refreshing = false
      this.onChange()
    }
  }

  /** The native browser saw the service set change; probe anything newly visible. */
  handleLanCacheUpdated(): void {
    void Promise.all(this.probeKnownLanAddresses(this.pairings))
  }

  private probeKnownLanAddresses(pairings: SavedPairing[]): Promise<void>[] {
    return pairings.flatMap((pairing) => {
      if (this.reachability.get(pairing.id)?.lan) return []
      const address = this.resolveLanAddress(pairing)
      if (!address) return []
      const key = `${pairing.id}|${address.host}:${address.port}`
      if (this.inFlightLanProbes.has(key)) return []
      this.inFlightLanProbes.add(key)
      return [this.ports.checkLan(address.host, address.port)
        .then((reachable) => {
          if (reachable) this.addresses.set(pairing.id, address)
          this.apply(pairing.id, { lan: reachable })
        })
        .finally(() => { this.inFlightLanProbes.delete(key) })]
    })
  }

  /**
   * mDNS wins over the address stored at pairing time: a desktop's IP changes
   * with its network, and the advertised record is the one that is current.
   */
  private resolveLanAddress(pairing: SavedPairing): LanAddress | null {
    const hit = this.ports.lookupLan(this.ports.roomIdFor(pairing.secret))
    if (hit) return { host: hit.host, port: hit.port }
    return this.ports.lanAddressOf(pairing)
  }

  private apply(pairingId: string, patch: Partial<DeviceReachability>): void {
    const current = this.reachability.get(pairingId) ?? UNREACHABLE
    const next = { ...current, ...patch }
    if (same(current, next)) return
    this.reachability.set(pairingId, next)
    this.onChange()
  }
}
