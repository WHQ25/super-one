import { gcm } from '@noble/ciphers/aes.js'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/ciphers/utils.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const FILE_ENVELOPE_VERSION = 0x01
export const FILE_ENVELOPE_FORMAT_CHUNKED = 0x02
export const FILE_ENVELOPE_HEADER_SIZE = 16
export const FILE_CHUNK_SIZE = 4 * 1024 * 1024
export const FILE_GCM_IV_SIZE = 12
export const FILE_GCM_TAG_SIZE = 16

export function bytesToHexString(bytes: Uint8Array): string {
  return bytesToHex(bytes)
}

export function hexToByteArray(hex: string): Uint8Array {
  return hexToBytes(hex)
}

export function deriveKeys(masterSecretHex: string): {
  channelKeyHex: string
  aesKeyBytes: Uint8Array
} {
  const ikm = hexToBytes(masterSecretHex)
  const empty = new Uint8Array(0)
  const channelKey = hkdf(sha256, ikm, empty, encoder.encode('channel-key'), 32)
  const aesKeyBytes = hkdf(sha256, ikm, empty, encoder.encode('aes-key'), 32)
  return { channelKeyHex: bytesToHex(channelKey), aesKeyBytes }
}

export function encryptPayload(aesKeyBytes: Uint8Array, payload: unknown): string {
  const iv = randomBytes(12)
  const sealed = gcm(aesKeyBytes, iv).encrypt(encoder.encode(JSON.stringify(payload)))
  const out = new Uint8Array(12 + sealed.length)
  out.set(iv, 0)
  out.set(sealed, 12)
  return uint8ToBase64(out)
}

export function decryptPayload(aesKeyBytes: Uint8Array, data: string): unknown {
  const bytes = base64ToUint8(data)
  const iv = bytes.subarray(0, 12)
  const ciphertext = bytes.subarray(12)
  const plain = gcm(aesKeyBytes, iv).decrypt(ciphertext)
  return JSON.parse(decoder.decode(plain)) as unknown
}

export function computeHmacToken(channelKeyHex: string, role: string, timestamp: string): string {
  return bytesToHex(hmac(sha256, hexToBytes(channelKeyHex), encoder.encode(`${role}:${timestamp}`)))
}

export function computeRoomId(channelKeyHex: string): string {
  return bytesToHex(sha256(hexToBytes(channelKeyHex))).slice(0, 32)
}

function chunkAad(channelKeyHex: string, r2Key: string, chunkIndex: number): Uint8Array {
  return encoder.encode(`${channelKeyHex}:${r2Key}:${chunkIndex}`)
}

export function encryptBytesChunked(
  aesKeyBytes: Uint8Array,
  plaintext: Uint8Array,
  r2Key: string,
  channelKeyHex: string,
): Uint8Array {
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
    const chunk = plaintext.subarray(start, end)
    const iv = randomBytes(FILE_GCM_IV_SIZE)
    const sealed = gcm(aesKeyBytes, iv, chunkAad(channelKeyHex, r2Key, i)).encrypt(chunk)
    out.set(iv, writeOffset)
    writeOffset += FILE_GCM_IV_SIZE
    out.set(sealed, writeOffset)
    writeOffset += sealed.length
  }
  return out
}

export function decryptBytesChunked(
  aesKeyBytes: Uint8Array,
  envelope: Uint8Array,
  r2Key: string,
  channelKeyHex: string,
): Uint8Array {
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
    const sealed = envelope.subarray(readOffset, readOffset + sealedLen)
    readOffset += sealedLen
    const plain = gcm(aesKeyBytes, iv, chunkAad(channelKeyHex, r2Key, i)).decrypt(sealed)
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

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function base64ToUint8(data: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(data, 'base64'))
  const binary = atob(data)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
