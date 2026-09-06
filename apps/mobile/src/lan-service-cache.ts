import { LAN_TXT_ROOM_ID } from '@superone/relay-client'
import type { LanService } from './device-discovery'

/** One resolved Bonjour record as the native browser reports it. */
export type NativeLanRecord = {
  host?: string | null
  port?: number | null
  /** Resolved IPs, best first. IPv4 is preferred because the LAN server binds it. */
  addresses?: string[] | null
  txt?: Record<string, string> | null
}

function looksIpv4(address: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(address)
}

/** IPv4 beats IPv6 beats the .local hostname, which needs another resolution step. */
export function pickHost(record: NativeLanRecord): string | null {
  const addresses = record.addresses ?? []
  return addresses.find(looksIpv4) ?? addresses[0] ?? record.host ?? null
}

/**
 * Keep only records that can actually be dialled and matched to a pairing. A
 * record without a room id is some other app's service, or ours mid-resolution.
 */
export function collectLanServices(records: readonly NativeLanRecord[]): LanService[] {
  const services: LanService[] = []
  for (const record of records) {
    const roomId = record.txt?.[LAN_TXT_ROOM_ID]
    const host = pickHost(record)
    const port = record.port
    if (!roomId || !host || typeof port !== 'number' || port <= 0) continue
    services.push({ roomId, host, port, hostName: record.txt?.hostName })
  }
  return services
}

/**
 * The rooms currently visible on this network. Notifies only when the set
 * meaningfully changes, so a browser that re-reports the same services on every
 * network blip cannot drive a probe storm.
 */
export class LanServiceCache {
  private services = new Map<string, LanService>()

  get size(): number {
    return this.services.size
  }

  lookup(roomId: string): LanService | null {
    return this.services.get(roomId) ?? null
  }

  list(): LanService[] {
    return [...this.services.values()]
  }

  clear(): boolean {
    return this.replace([])
  }

  /** Returns whether anything changed. */
  replace(records: readonly NativeLanRecord[]): boolean {
    const next = new Map<string, LanService>()
    for (const service of collectLanServices(records)) next.set(service.roomId, service)
    if (!this.changed(next)) return false
    this.services = next
    return true
  }

  private changed(next: Map<string, LanService>): boolean {
    if (next.size !== this.services.size) return true
    for (const [roomId, service] of this.services) {
      const other = next.get(roomId)
      if (!other || other.host !== service.host || other.port !== service.port) return true
    }
    return false
  }
}
