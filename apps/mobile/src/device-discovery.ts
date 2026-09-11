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
  /** Tear the mDNS browser down and start it from nothing, forgetting every record. */
  restartBrowsing: () => Promise<void>
  /** Every mDNS record for a room; empty when the desktop is not advertising. */
  lookupLan: (roomId: string) => LanService[]
}

function sameAddress(a: LanAddress, b: LanAddress): boolean {
  return a.host === b.host && a.port === b.port
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
   *
   * A reset also restarts the mDNS browse. The desktop's LAN port is ephemeral,
   * so a desktop that restarted keeps its Bonjour name but answers on a new
   * port — and neither platform re-resolves a name it has already reported, so
   * a browse left running would hand back the dead port on every refresh.
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
      await (reset ? this.ports.restartBrowsing() : this.ports.ensureBrowsing())
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
    return pairings.flatMap((pairing) => this.lanCandidates(pairing).flatMap((address) => {
      // Already reachable there — but an advertised port that differs from the
      // one that answered means the desktop restarted, and needs re-probing.
      const known = this.addresses.get(pairing.id)
      if (this.reachability.get(pairing.id)?.lan && known && sameAddress(known, address)) return []
      const key = `${pairing.id}|${address.host}:${address.port}`
      if (this.inFlightLanProbes.has(key)) return []
      this.inFlightLanProbes.add(key)
      return [this.ports.checkLan(address.host, address.port)
        .then((reachable) => {
          if (reachable) {
            this.addresses.set(pairing.id, address)
            this.apply(pairing.id, { lan: true })
            return
          }
          // Another candidate may already have answered; only a failure of the
          // address being relied on — or of the only one there was — is offline.
          const current = this.addresses.get(pairing.id)
          if (current && !sameAddress(current, address)) return
          this.addresses.delete(pairing.id)
          this.apply(pairing.id, { lan: false })
        })
        .finally(() => { this.inFlightLanProbes.delete(key) })]
    }))
  }

  /**
   * mDNS wins over the address stored at pairing time: a desktop's IP and port
   * change with every launch, and the advertised records are the current ones.
   * All of them are candidates — after an unclean restart the dead port is still
   * advertised beside the live one until its record expires.
   */
  private lanCandidates(pairing: SavedPairing): LanAddress[] {
    const hits = this.ports.lookupLan(this.ports.roomIdFor(pairing.secret))
    if (hits.length > 0) return hits.map(({ host, port }) => ({ host, port }))
    const stored = this.ports.lanAddressOf(pairing)
    return stored ? [stored] : []
  }

  private apply(pairingId: string, patch: Partial<DeviceReachability>): void {
    const current = this.reachability.get(pairingId) ?? UNREACHABLE
    const next = { ...current, ...patch }
    if (same(current, next)) return
    this.reachability.set(pairingId, next)
    this.onChange()
  }
}
