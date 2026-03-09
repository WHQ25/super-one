const encoder = new TextEncoder()

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function importKeyMaterial(masterSecretHex: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(masterSecretHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
  return crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits'])
}

export async function deriveKeys(masterSecretHex: string): Promise<{
  channelKeyHex: string
  aesKey: CryptoKey
}> {
  const keyMaterial = await importKeyMaterial(masterSecretHex)
  const channelBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('channel-key') },
    keyMaterial,
    256,
  )
  const channelKeyHex = bytesToHex(channelBits)

  const keyMaterial2 = await importKeyMaterial(masterSecretHex)
  const aesBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('aes-key') },
    keyMaterial2,
    256,
  )
  const aesKey = await crypto.subtle.importKey('raw', aesBits, 'AES-GCM', false, ['encrypt', 'decrypt'])

  return { channelKeyHex, aesKey }
}

export async function encryptPayload(aesKey: CryptoKey, payload: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = encoder.encode(JSON.stringify(payload))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, data)
  const result = new Uint8Array(12 + encrypted.byteLength)
  result.set(iv, 0)
  result.set(new Uint8Array(encrypted), 12)
  return btoa(String.fromCharCode(...result))
}

export async function decryptPayload(aesKey: CryptoKey, data: string): Promise<unknown> {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  const iv = bytes.slice(0, 12)
  const ciphertext = bytes.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext)
  return JSON.parse(new TextDecoder().decode(decrypted))
}

export async function computeSignature(
  timestamp: number,
  nonce: string,
  channelKeyHex: string,
): Promise<string> {
  const parts = [timestamp.toString(), nonce, channelKeyHex].sort()
  const hash = await crypto.subtle.digest('SHA-1', encoder.encode(parts.join('')))
  return bytesToHex(hash)
}

export function generateNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
