const encoder = new TextEncoder()

export function verifyTimestamp(ts: string): boolean {
  const timestamp = parseInt(ts, 10)
  if (isNaN(timestamp)) return false
  return Math.abs(Date.now() - timestamp) <= 30_000
}

export async function computeHmacToken(
  channelKeyHex: string,
  role: string,
  timestamp: string,
): Promise<string> {
  const keyBytes = hexToBytes(channelKeyHex)
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const data = encoder.encode(`${role}:${timestamp}`)
  const sig = await crypto.subtle.sign('HMAC', key, data)
  return bytesToHex(sig)
}

export async function computeRoomId(channelKeyHex: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', hexToBytes(channelKeyHex))
  return bytesToHex(hash).substring(0, 32)
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
