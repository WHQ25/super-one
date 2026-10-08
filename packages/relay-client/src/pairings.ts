export type SavedPairing = {
  /** Verified over the authenticated host connection; absent on legacy pairings. */
  environmentId?: string
  id: string
  /** User-assigned label. Host name remains the transport-reported identity. */
  name?: string
  relayUrl: string
  /** This phone's channel secret for the host (hex). Never sent over the network. */
  secret: string
  /** Channel key id issued at pairing; absent on pairings made before per-device secrets. */
  keyId?: string
  /** The host's relay room and mDNS `roomId`, delivered at pairing. */
  roomId?: string
  hostName?: string
  lan?: string
  desktopDeviceId?: string
}

export type Kv = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

export const PAIRINGS_KEY = 'superone:pairings'
export const MOBILE_ID_KEY = 'superone:mobile_id'

export function parsePairings(raw: string | null): SavedPairing[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((row): row is SavedPairing => {
      if (!row || typeof row !== 'object') return false
      const r = row as Record<string, unknown>
      return typeof r.id === 'string' && typeof r.relayUrl === 'string' && typeof r.secret === 'string'
    })
  } catch {
    return []
  }
}

/**
 * Pairings from before per-device channel credentials carry the retired shared
 * secret, which no host accepts any more; they must be paired again.
 */
export function pairingNeedsRepair(pairing: SavedPairing): boolean {
  return !pairing.keyId || !pairing.roomId
}

/** The credential and room a connection needs, or null when the pairing must be redone. */
export function hostLinkOf(pairing: SavedPairing): { credential: { keyId: string; secretHex: string }; roomId: string } | null {
  if (!pairing.keyId || !pairing.roomId) return null
  return { credential: { keyId: pairing.keyId, secretHex: pairing.secret }, roomId: pairing.roomId }
}

export function serializePairings(pairings: SavedPairing[]): string {
  return JSON.stringify(pairings)
}

export async function loadPairings(kv: Kv): Promise<SavedPairing[]> {
  return parsePairings(await kv.get(PAIRINGS_KEY))
}

export async function savePairings(kv: Kv, pairings: SavedPairing[]): Promise<void> {
  await kv.set(PAIRINGS_KEY, serializePairings(pairings))
}

export function upsertPairing(list: SavedPairing[], next: SavedPairing): SavedPairing[] {
  const i = list.findIndex((p) => p.id === next.id || (p.relayUrl === next.relayUrl && p.secret === next.secret))
  if (i < 0) return [...list, next]
  const copy = list.slice()
  copy[i] = { ...copy[i], ...next }
  return copy
}

export function memoryKv(seed: Record<string, string> = {}): Kv {
  const store = { ...seed }
  return {
    async get(key) {
      return store[key] ?? null
    },
    async set(key, value) {
      store[key] = value
    },
  }
}
