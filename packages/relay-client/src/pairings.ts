export type SavedPairing = {
  id: string
  relayUrl: string
  secret: string
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
