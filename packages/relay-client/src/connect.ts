export type TransportKind = 'relay' | 'lan'

/**
 * Bonjour service the desktop publishes for its LAN server. Must stay in step
 * with `LAN_SERVICE_FQDN` in the desktop's `lan-advertiser.ts`, and with the
 * `NSBonjourServices` entry in the mobile app config.
 */
export const LAN_SERVICE_TYPE = '_superone._tcp'
/** TXT key carrying the room id, which is how a record is matched to a pairing. */
export const LAN_TXT_ROOM_ID = 'roomId'

/**
 * The room is the paired host's relay room, delivered at pairing; the relay
 * routes by it and by the device slot, and sees only sealed frames.
 */
export function buildRelayWsUrl(opts: {
  relayUrl: string
  roomId: string
  role: 'mobile' | 'desktop'
  deviceId?: string
  now?: () => number
}): string {
  const ts = String((opts.now ?? Date.now)())
  const base = opts.relayUrl.replace(/\/$/, '')
  const deviceQuery = opts.role === 'mobile' && opts.deviceId
    ? `&deviceId=${encodeURIComponent(opts.deviceId)}`
    : ''
  return `${base}/ws?role=${opts.role}&ts=${ts}&room=${encodeURIComponent(opts.roomId)}${deviceQuery}`
}

export function buildLanWsUrl(host: string, port: number): string {
  return `ws://${host}:${port}/ws`
}
