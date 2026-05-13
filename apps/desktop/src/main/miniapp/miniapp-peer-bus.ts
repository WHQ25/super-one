export interface PeerEventListener {
  (event: string, payload: unknown): void
}

export interface PeerBroadcaster {
  (sessionId: string, appId: string, event: string, payload: unknown): void
}

interface BusEntry {
  listeners: Set<PeerEventListener>
}

const buses = new Map<string, BusEntry>()
let broadcaster: PeerBroadcaster | null = null

export function setPeerBroadcaster(fn: PeerBroadcaster | null): void {
  broadcaster = fn
}

function busKey(sessionId: string, appId: string): string {
  return `${sessionId}::${appId}`
}

export function subscribePeer(
  sessionId: string,
  appId: string,
  listener: PeerEventListener,
): () => void {
  const key = busKey(sessionId, appId)
  let entry = buses.get(key)
  if (!entry) {
    entry = { listeners: new Set() }
    buses.set(key, entry)
  }
  entry.listeners.add(listener)
  return () => {
    const e = buses.get(key)
    if (!e) return
    e.listeners.delete(listener)
    if (e.listeners.size === 0) buses.delete(key)
  }
}

export function emitPeer(
  sessionId: string,
  appId: string,
  event: string,
  payload: unknown,
): void {
  if (broadcaster) {
    try { broadcaster(sessionId, appId, event, payload) } catch { /* swallow */ }
  }
  const entry = buses.get(busKey(sessionId, appId))
  if (!entry) return
  for (const listener of entry.listeners) {
    try {
      listener(event, payload)
    } catch {
      // listeners must not throw upstream; swallow to keep broadcast going
    }
  }
}

export function clearPeerBus(sessionId: string, appId: string): void {
  buses.delete(busKey(sessionId, appId))
}

export function _resetAllForTests(): void {
  buses.clear()
  broadcaster = null
}
