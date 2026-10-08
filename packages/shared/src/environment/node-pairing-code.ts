/**
 * Pairing code a desktop node shows (text or QR) and another desktop pastes.
 *
 * Format: `superone-node:<version>:<base64url JSON>`. The JSON carries the
 * node URL, the single-use pairing token, the encrypted-channel credential and
 * the token expiry. The channel secret travels only inside this code, never
 * over the network, so the code must not be logged.
 */

export const NODE_PAIRING_CODE_PREFIX = 'superone-node:'
export const NODE_PAIRING_CODE_VERSION = 1

export interface NodePairingCode {
  /** Node base URL (`http://host:port`). */
  url: string
  pairingToken: string
  channel: { keyId: string; secretHex: string }
  /** Token expiry, epoch milliseconds. */
  expiresAt: number
}

export type NodePairingCodeErrorCode = 'invalid' | 'unsupported_version' | 'expired'

export class NodePairingCodeError extends Error {
  constructor(readonly code: NodePairingCodeErrorCode, message: string) {
    super(message)
    this.name = 'NodePairingCodeError'
  }
}

interface WirePayload {
  u: string
  t: string
  k: string
  s: string
  e: number
}

const SECRET_HEX = /^[0-9a-f]{64}$/i

export function encodeNodePairingCode(code: NodePairingCode): string {
  const payload: WirePayload = {
    u: code.url,
    t: code.pairingToken,
    k: code.channel.keyId,
    s: code.channel.secretHex,
    e: code.expiresAt,
  }
  return `${NODE_PAIRING_CODE_PREFIX}${NODE_PAIRING_CODE_VERSION}:${toBase64Url(JSON.stringify(payload))}`
}

/**
 * Parse a pasted or scanned code. Whitespace (line wraps from copy/paste) is
 * ignored. Throws {@link NodePairingCodeError}; `expired` only when `now` is given.
 */
export function decodeNodePairingCode(input: string, now?: number): NodePairingCode {
  const raw = input.replace(/\s+/g, '')
  if (!raw.startsWith(NODE_PAIRING_CODE_PREFIX)) throw invalid('missing prefix')
  const rest = raw.slice(NODE_PAIRING_CODE_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) throw invalid('missing version')
  const version = Number(rest.slice(0, sep))
  if (!Number.isInteger(version) || version < 1) throw invalid('bad version')
  if (version > NODE_PAIRING_CODE_VERSION) {
    throw new NodePairingCodeError('unsupported_version', `pairing code version ${version} is not supported`)
  }

  let payload: Partial<WirePayload>
  try {
    payload = JSON.parse(fromBase64Url(rest.slice(sep + 1))) as Partial<WirePayload>
  } catch {
    throw invalid('unreadable payload')
  }
  if (!payload || typeof payload !== 'object') throw invalid('unreadable payload')
  const { u, t, k, s, e } = payload
  if (typeof u !== 'string' || !isHttpUrl(u)) throw invalid('bad url')
  if (typeof t !== 'string' || !t) throw invalid('missing token')
  if (typeof k !== 'string' || !k) throw invalid('missing channel key id')
  if (typeof s !== 'string' || !SECRET_HEX.test(s)) throw invalid('bad channel secret')
  if (typeof e !== 'number' || !Number.isFinite(e)) throw invalid('missing expiry')
  if (now !== undefined && e <= now) throw new NodePairingCodeError('expired', 'pairing code expired')
  return { url: u.replace(/\/+$/, ''), pairingToken: t, channel: { keyId: k, secretHex: s }, expiresAt: e }
}

function invalid(detail: string): NodePairingCodeError {
  return new NodePairingCodeError('invalid', `invalid pairing code: ${detail}`)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname
  } catch {
    return false
  }
}

function toBase64Url(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('not base64url')
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}
