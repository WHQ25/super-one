/**
 * How a saved device presents in the device list. Mirrors the Flutter
 * `ConnectionStatus` enum so the two clients describe a desktop identically:
 * reachability (`online*`) is what discovery found, `connected*` is the socket
 * this app currently holds, and the LAN/cloud half names the transport.
 */
export type DeviceStatus =
  | 'offline'
  | 'searchingLan'
  | 'onlineLan'
  | 'onlineCloud'
  | 'connecting'
  | 'connectedLan'
  | 'connectedCloud'

export type DeviceReachability = { lan: boolean; relay: boolean }

export type ReconnectInfo = {
  attempting: boolean
  waiting: boolean
  delayMs: number
  nextAtMs: number | null
}

export type DeviceStatusTone = 'success' | 'danger' | 'warning' | 'muted' | 'foreground'
/** Semantic glyph name; the renderer maps it to a lucide icon. */
export type DeviceStatusGlyph = 'wifi' | 'cloud' | 'cloud-off' | 'sync' | 'radar'

export type DeviceStatusView = {
  status: DeviceStatus
  label: string
  tone: DeviceStatusTone
  glyph: DeviceStatusGlyph
  spin: boolean
}

/** A backoff this long means the desktop is not coming back on its own. */
const SLOW_RETRY_MS = 8_000

export function isReachable(status: DeviceStatus): boolean {
  return status !== 'offline' && status !== 'searchingLan' && status !== 'connecting'
}

export function isLanStatus(status: DeviceStatus): boolean {
  return status === 'onlineLan' || status === 'connectedLan'
}

/**
 * Single source of truth for a row's status. Priority matches Flutter's
 * `_deriveStatus`: the socket we hold outranks anything discovery reports, and
 * a LAN route outranks the cloud because it is the one we would actually take.
 */
export function deriveDeviceStatus(input: {
  pairingId: string
  activePairingId: string | null
  activeTransport: 'lan' | 'relay' | null
  connectionState: 'connected' | 'reconnecting' | 'offline'
  connectingPairingId: string | null
  reachability: DeviceReachability | undefined
  searchingLan: boolean
}): DeviceStatus {
  const active = input.activePairingId !== null && input.activePairingId === input.pairingId
  if (active && input.connectionState === 'connected') {
    return input.activeTransport === 'lan' ? 'connectedLan' : 'connectedCloud'
  }
  if (input.connectingPairingId === input.pairingId) return 'connecting'
  if (active && input.connectionState === 'reconnecting') return 'connecting'
  if (input.reachability?.lan) return 'onlineLan'
  if (input.reachability?.relay) return 'onlineCloud'
  if (input.searchingLan) return 'searchingLan'
  return 'offline'
}

function retryLabel(reconnect: ReconnectInfo, nowMs: number): string | null {
  if (reconnect.waiting && reconnect.nextAtMs !== null) {
    const remaining = Math.max(0, Math.ceil((reconnect.nextAtMs - nowMs) / 1_000))
    return `Retrying in ${remaining}s`
  }
  if (reconnect.attempting && reconnect.delayMs > 0) return 'Reconnecting…'
  return null
}

export function describeDeviceStatus(
  status: DeviceStatus,
  opts: { reconnect?: ReconnectInfo | null; nowMs?: number } = {},
): DeviceStatusView {
  switch (status) {
    case 'offline':
      return { status, label: 'Offline', tone: 'danger', glyph: 'cloud-off', spin: false }
    case 'searchingLan':
      return { status, label: 'Searching local network…', tone: 'muted', glyph: 'radar', spin: true }
    case 'onlineLan':
      return { status, label: 'Online', tone: 'success', glyph: 'wifi', spin: false }
    case 'onlineCloud':
      return { status, label: 'Online', tone: 'success', glyph: 'cloud', spin: false }
    case 'connectedLan':
      return { status, label: 'Connected', tone: 'success', glyph: 'wifi', spin: false }
    case 'connectedCloud':
      return { status, label: 'Connected', tone: 'success', glyph: 'cloud', spin: false }
    case 'connecting': {
      const reconnect = opts.reconnect ?? null
      const label = reconnect ? retryLabel(reconnect, opts.nowMs ?? Date.now()) : null
      return {
        status,
        label: label ?? 'Connecting…',
        tone: (reconnect?.delayMs ?? 0) >= SLOW_RETRY_MS ? 'warning' : 'foreground',
        glyph: 'sync',
        spin: true,
      }
    }
  }
}
