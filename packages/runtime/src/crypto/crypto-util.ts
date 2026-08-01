import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto'

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function hmacSha256Hex(key: Buffer | string, data: string | Buffer): string {
  return createHmac('sha256', key).update(data).digest('hex')
}

/** Constant-time compare of equal-length hex/utf8 strings. */
export function safeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export interface Ed25519KeyPair {
  privateKeyPem: string
  publicKeyPem: string
  publicKeyRaw: Buffer
  fingerprint: string
}

export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const publicKeyRaw = publicKeyToRaw(publicKey)
  return {
    privateKeyPem,
    publicKeyPem,
    publicKeyRaw,
    fingerprint: fingerprintPublicKey(publicKeyRaw),
  }
}

export function publicKeyToRaw(publicKey: KeyObject): Buffer {
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  if (der.length === 44 && der.subarray(0, 12).equals(ED25519_SPKI_PREFIX)) {
    return der.subarray(12)
  }
  // Fallback: hash full SPKI if format unexpected
  return createHash('sha256').update(der).digest()
}

export function fingerprintPublicKey(publicKeyRaw: Buffer): string {
  return sha256Hex(publicKeyRaw)
}

export function fingerprintPublicKeyPem(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem)
  return fingerprintPublicKey(publicKeyToRaw(key))
}

export function loadPrivateKey(pem: string): KeyObject {
  return createPrivateKey(pem)
}

export function loadPublicKey(pem: string): KeyObject {
  return createPublicKey(pem)
}

export function signPayload(privateKeyPem: string, payload: string | Buffer): string {
  const key = loadPrivateKey(privateKeyPem)
  return sign(null, Buffer.from(payload), key).toString('base64url')
}

export function verifyPayload(publicKeyPem: string, payload: string | Buffer, signatureB64url: string): boolean {
  try {
    const key = loadPublicKey(publicKeyPem)
    return verify(null, Buffer.from(payload), key, Buffer.from(signatureB64url, 'base64url'))
  } catch {
    return false
  }
}

/** Compact signed token: base64url(json).base64url(sig) */
export function createSignedToken(privateKeyPem: string, claims: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const sig = signPayload(privateKeyPem, body)
  return `${body}.${sig}`
}

export function verifySignedToken(
  publicKeyPem: string,
  token: string,
): { ok: true; claims: Record<string, unknown> } | { ok: false; reason: string } {
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed token' }
  const [body, sig] = parts
  if (!body || !sig) return { ok: false, reason: 'malformed token' }
  if (!verifyPayload(publicKeyPem, body, sig)) return { ok: false, reason: 'invalid signature' }
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>
    return { ok: true, claims }
  } catch {
    return { ok: false, reason: 'invalid claims json' }
  }
}
