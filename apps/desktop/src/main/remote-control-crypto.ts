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

export const FILE_ENVELOPE_VERSION = 0x01
export const FILE_ENVELOPE_FORMAT_CHUNKED = 0x02
export const FILE_ENVELOPE_HEADER_SIZE = 16
export const FILE_CHUNK_SIZE = 4 * 1024 * 1024
export const FILE_GCM_IV_SIZE = 12
export const FILE_GCM_TAG_SIZE = 16

function chunkAad(channelKeyHex: string, r2Key: string, chunkIndex: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${channelKeyHex}:${r2Key}:${chunkIndex}`) as Uint8Array<ArrayBuffer>
}

function ownedSlice(view: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(view.length)
  out.set(view)
  return out as Uint8Array<ArrayBuffer>
}

export async function encryptBytesChunked(
  aesKey: webcrypto.CryptoKey,
  plaintext: Uint8Array,
  r2Key: string,
  channelKeyHex: string,
): Promise<Uint8Array> {
  const chunkCount = plaintext.length === 0 ? 1 : Math.ceil(plaintext.length / FILE_CHUNK_SIZE)
  const perChunkOverhead = FILE_GCM_IV_SIZE + FILE_GCM_TAG_SIZE
  const totalSize = FILE_ENVELOPE_HEADER_SIZE + plaintext.length + chunkCount * perChunkOverhead
  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer)
  out[0] = FILE_ENVELOPE_VERSION
  out[1] = FILE_ENVELOPE_FORMAT_CHUNKED
  view.setUint32(2, FILE_CHUNK_SIZE, true)
  view.setUint32(6, chunkCount, true)

  let writeOffset = FILE_ENVELOPE_HEADER_SIZE
  for (let i = 0; i < chunkCount; i++) {
    const start = i * FILE_CHUNK_SIZE
    const end = Math.min(start + FILE_CHUNK_SIZE, plaintext.length)
    const chunk = ownedSlice(plaintext.subarray(start, end))
    const iv = webcrypto.getRandomValues(new Uint8Array(FILE_GCM_IV_SIZE))
    const aad = chunkAad(channelKeyHex, r2Key, i)
    const sealed = new Uint8Array(
      await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, aesKey, chunk),
    )
    out.set(iv, writeOffset)
    writeOffset += FILE_GCM_IV_SIZE
    out.set(sealed, writeOffset)
    writeOffset += sealed.length
  }
  return out
}

export async function decryptBytesChunked(
  aesKey: webcrypto.CryptoKey,
  envelope: Uint8Array,
  r2Key: string,
  channelKeyHex: string,
): Promise<Uint8Array> {
  if (envelope.length < FILE_ENVELOPE_HEADER_SIZE) {
    throw new Error('encrypted file: envelope too short')
  }
  if (envelope[0] !== FILE_ENVELOPE_VERSION) {
    throw new Error(`encrypted file: unsupported version 0x${envelope[0].toString(16)}`)
  }
  if (envelope[1] !== FILE_ENVELOPE_FORMAT_CHUNKED) {
    throw new Error(`encrypted file: unsupported format 0x${envelope[1].toString(16)}`)
  }
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength)
  const chunkSize = view.getUint32(2, true)
  const chunkCount = view.getUint32(6, true)
  if (chunkSize === 0 || chunkCount === 0) {
    throw new Error('encrypted file: invalid chunk parameters')
  }

  let readOffset = FILE_ENVELOPE_HEADER_SIZE
  const plaintextChunks: Uint8Array[] = []
  let totalPlaintext = 0
  for (let i = 0; i < chunkCount; i++) {
    if (readOffset + FILE_GCM_IV_SIZE + FILE_GCM_TAG_SIZE > envelope.length) {
      throw new Error('encrypted file: truncated chunk header')
    }
    const iv = envelope.subarray(readOffset, readOffset + FILE_GCM_IV_SIZE)
    readOffset += FILE_GCM_IV_SIZE
    const isLast = i === chunkCount - 1
    const remainingBytes = envelope.length - readOffset
    const sealedLen = isLast ? remainingBytes : chunkSize + FILE_GCM_TAG_SIZE
    if (sealedLen < FILE_GCM_TAG_SIZE || readOffset + sealedLen > envelope.length) {
      throw new Error('encrypted file: truncated chunk body')
    }
    const sealed = ownedSlice(envelope.subarray(readOffset, readOffset + sealedLen))
    const ivOwned = ownedSlice(iv)
    readOffset += sealedLen
    const aad = chunkAad(channelKeyHex, r2Key, i)
    const plain = new Uint8Array(
      await subtle.decrypt({ name: 'AES-GCM', iv: ivOwned, additionalData: aad }, aesKey, sealed),
    )
    plaintextChunks.push(plain)
    totalPlaintext += plain.length
  }
  if (readOffset !== envelope.length) {
    throw new Error('encrypted file: trailing bytes after last chunk')
  }
  const merged = new Uint8Array(totalPlaintext)
  let mergeOffset = 0
  for (const chunk of plaintextChunks) {
    merged.set(chunk, mergeOffset)
    mergeOffset += chunk.length
  }
  return merged
}
