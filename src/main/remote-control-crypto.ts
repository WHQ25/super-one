import { webcrypto } from 'node:crypto'

const subtle = webcrypto.subtle
const encoder = new TextEncoder()

export function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const arr = hex.match(/.{2}/g)!.map((h) => parseInt(h, 16))
  return new Uint8Array(arr) as Uint8Array<ArrayBuffer>
}

async function importKeyMaterial(masterSecretHex: string): Promise<webcrypto.CryptoKey> {
  return subtle.importKey('raw', hexToBytes(masterSecretHex), 'HKDF', false, ['deriveBits'])
}

export async function deriveKeys(masterSecretHex: string): Promise<{
  channelKeyHex: string
  aesKey: webcrypto.CryptoKey
}> {
  const keyMaterial = await importKeyMaterial(masterSecretHex)
  const channelBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('channel-key') },
    keyMaterial,
    256,
  )
  const channelKeyHex = bytesToHex(channelBits)

  const aesBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('aes-key') },
    await importKeyMaterial(masterSecretHex),
    256,
  )
  const aesKey = await subtle.importKey('raw', aesBits, 'AES-GCM', false, ['encrypt', 'decrypt'])

  return { channelKeyHex, aesKey }
}

export async function importRawAesKey(keyHex: string): Promise<webcrypto.CryptoKey> {
  return subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptPayload(aesKey: webcrypto.CryptoKey, payload: unknown): Promise<string> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoder.encode(JSON.stringify(payload)))
  const result = new Uint8Array(12 + encrypted.byteLength)
  result.set(iv, 0)
  result.set(new Uint8Array(encrypted), 12)
  return Buffer.from(result).toString('base64')
}

export async function decryptPayload(aesKey: webcrypto.CryptoKey, data: string): Promise<unknown> {
  const bytes = Buffer.from(data, 'base64')
  const iv = bytes.subarray(0, 12)
  const ciphertext = bytes.subarray(12)
  const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext)
  return JSON.parse(new TextDecoder().decode(decrypted))
}

export async function computeHmacToken(channelKeyHex: string, role: string, timestamp: string): Promise<string> {
  const key = await subtle.importKey('raw', hexToBytes(channelKeyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await subtle.sign('HMAC', key, encoder.encode(`${role}:${timestamp}`))
  return bytesToHex(sig)
}

export async function computeRoomId(channelKeyHex: string): Promise<string> {
  const hash = await subtle.digest('SHA-256', hexToBytes(channelKeyHex))
  return bytesToHex(hash).substring(0, 32)
}
