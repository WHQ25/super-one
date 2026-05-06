import { webcrypto } from 'node:crypto'

const subtle = webcrypto.subtle
const encoder = new TextEncoder()

const TOKEN_TTL_MS = 60_000

export interface LanFileTokenPayload {
  path: string
  expiresAt: number
  nonce: string
}

export interface LanFileTokenSigner {
  sign: (path: string, opts?: { ttlMs?: number; now?: number }) => Promise<string>
  verify: (token: string, opts?: { now?: number }) => Promise<LanFileTokenPayload | null>
}

export async function deriveFileTokenKey(masterAesKey: webcrypto.CryptoKey): Promise<webcrypto.CryptoKey> {
  const exported = await subtle.exportKey('raw', masterAesKey)
  const material = await subtle.importKey('raw', exported, 'HKDF', false, ['deriveBits'])
  const hmacBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('lan-file-token') },
    material,
    256,
  )
  return subtle.importKey('raw', hmacBits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function deriveFileTokenKeyFromExtractable(
  masterSecretHex: string,
): Promise<webcrypto.CryptoKey> {
  const seed = hexToBytes(masterSecretHex)
  const material = await subtle.importKey('raw', seed, 'HKDF', false, ['deriveBits'])
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('lan-file-token') },
    material,
    256,
  )
  return subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export function createLanFileTokenSigner(hmacKey: webcrypto.CryptoKey): LanFileTokenSigner {
  return {
    sign: (path, opts = {}) => signFileToken(hmacKey, path, opts),
    verify: (token, opts = {}) => verifyFileToken(hmacKey, token, opts),
  }
}

async function signFileToken(
  hmacKey: webcrypto.CryptoKey,
  path: string,
  opts: { ttlMs?: number; now?: number } = {},
): Promise<string> {
  const now = opts.now ?? Date.now()
  const expiresAt = now + (opts.ttlMs ?? TOKEN_TTL_MS)
  const nonceBytes = webcrypto.getRandomValues(new Uint8Array(8))
  const nonce = bytesToHex(nonceBytes)
  const payload: LanFileTokenPayload = { path, expiresAt, nonce }
  const encoded = encodePayloadJson(payload)
  const sig = await subtle.sign('HMAC', hmacKey, encoder.encode(encoded))
  const sigB64 = bytesToBase64Url(new Uint8Array(sig))
  return `${encoded}.${sigB64}`
}

async function verifyFileToken(
  hmacKey: webcrypto.CryptoKey,
  token: string,
  opts: { now?: number } = {},
): Promise<LanFileTokenPayload | null> {
  const dot = token.lastIndexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const payloadEncoded = token.slice(0, dot)
  const sigEncoded = token.slice(dot + 1)
  let sig: Uint8Array<ArrayBuffer>
  try {
    sig = base64UrlToBytes(sigEncoded)
  } catch {
    return null
  }
  const ok = await subtle.verify('HMAC', hmacKey, sig, encoder.encode(payloadEncoded))
  if (!ok) return null
  let payload: LanFileTokenPayload
  try {
    payload = decodePayloadJson(payloadEncoded)
  } catch {
    return null
  }
  if (
    typeof payload.path !== 'string' ||
    typeof payload.expiresAt !== 'number' ||
    typeof payload.nonce !== 'string'
  ) {
    return null
  }
  const now = opts.now ?? Date.now()
  if (payload.expiresAt < now) return null
  return payload
}

function encodePayloadJson(payload: LanFileTokenPayload): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(payload)))
}

function decodePayloadJson(encoded: string): LanFileTokenPayload {
  const bytes = base64UrlToBytes(encoded)
  return JSON.parse(new TextDecoder().decode(bytes))
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const arr = hex.match(/.{2}/g)!.map((h) => parseInt(h, 16))
  return new Uint8Array(arr) as Uint8Array<ArrayBuffer>
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  const buf = Buffer.from(padded, 'base64')
  const out = new Uint8Array(buf.byteLength)
  out.set(buf)
  return out as Uint8Array<ArrayBuffer>
}
