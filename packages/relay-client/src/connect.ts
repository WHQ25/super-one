import { computeHmacToken, computeRoomId, deriveKeys } from './crypto'

export type TransportKind = 'relay' | 'lan'

/**
 * Bonjour service the desktop publishes for its LAN server. Must stay in step
 * with `LAN_SERVICE_FQDN` in the desktop's `lan-advertiser.ts`, and with the
 * `NSBonjourServices` entry in the mobile app config.
 */
export const LAN_SERVICE_TYPE = '_superone._tcp'
/** TXT key carrying the room id, which is how a record is matched to a pairing. */
export const LAN_TXT_ROOM_ID = 'roomId'

export async function buildRelayWsUrl(opts: {
  relayUrl: string
  masterSecret: string
  role: 'mobile' | 'desktop'
  deviceId?: string
  now?: () => number
}): Promise<{ url: string; aesKeyBytes: Uint8Array; channelKeyHex: string }> {
  const keys = deriveKeys(opts.masterSecret)
  const ts = String((opts.now ?? Date.now)())
  const token = computeHmacToken(keys.channelKeyHex, opts.role, ts)
  const room = computeRoomId(keys.channelKeyHex)
  const base = opts.relayUrl.replace(/\/$/, '')
  const deviceQuery = opts.role === 'mobile' && opts.deviceId
    ? `&deviceId=${encodeURIComponent(opts.deviceId)}`
    : ''
  return {
    url: `${base}/ws?role=${opts.role}&token=${token}&ts=${ts}&room=${room}${deviceQuery}`,
    aesKeyBytes: keys.aesKeyBytes,
    channelKeyHex: keys.channelKeyHex,
  }
}

export function buildLanWsUrl(host: string, port: number): string {
  return `ws://${host}:${port}/ws`
}
