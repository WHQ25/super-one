export const MIRROR_MARKER = String.fromCharCode(0x2063)
const BIT_ZERO = String.fromCharCode(0x200b)
const BIT_ONE = String.fromCharCode(0x200c)

function encodeAppIdAsZeroWidth(appId: string): string {
  const bytes = new TextEncoder().encode(appId)
  let out = ''
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      out += ((byte >> i) & 1) === 1 ? BIT_ONE : BIT_ZERO
    }
  }
  return out
}

function decodeAppIdFromZeroWidth(zw: string): string | null {
  if (zw.length === 0 || zw.length % 8 !== 0) return null
  const bytes = new Uint8Array(zw.length / 8)
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0
    for (let j = 0; j < 8; j++) {
      const ch = zw[i * 8 + j]
      if (ch === BIT_ONE) byte = (byte << 1) | 1
      else if (ch === BIT_ZERO) byte = byte << 1
      else return null
    }
    bytes[i] = byte
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export function wrapMiniAppMention(appId: string, appName: string): string {
  return `${MIRROR_MARKER}${encodeAppIdAsZeroWidth(appId)}${MIRROR_MARKER}@${appName}${MIRROR_MARKER}`
}

export interface MiniAppMentionMatch {
  start: number
  end: number
  appId: string
  appName: string
}

const MIRROR_REGEX_SOURCE = '\\u2063([\\u200B\\u200C]*)\\u2063@([^\\u2063\\n]+?)\\u2063'

export function findMiniAppMentionMarkers(text: string): MiniAppMentionMatch[] {
  const out: MiniAppMentionMatch[] = []
  const re = new RegExp(MIRROR_REGEX_SOURCE, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const appId = decodeAppIdFromZeroWidth(m[1])
    if (!appId) continue
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      appId,
      appName: m[2],
    })
  }
  return out
}
