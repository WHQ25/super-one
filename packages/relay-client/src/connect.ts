import { computeHmacToken, computeRoomId, deriveKeys } from './crypto'

export type TransportKind = 'relay' | 'lan'

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
