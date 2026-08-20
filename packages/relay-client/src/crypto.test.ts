import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FILE_ENVELOPE_FORMAT_CHUNKED,
  FILE_ENVELOPE_VERSION,
  computeHmacToken,
  computeRoomId,
  decryptBytesChunked,
  decryptPayload,
  deriveKeys,
  encryptBytesChunked,
  encryptPayload,
} from './crypto'

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../docs/design/relay-crypto-golden/vectors.json'), 'utf8'),
) as {
  masterSecretHex: string
  r2Key: string
  derived: { channelKeyHex: string }
  hmac: { role: string; timestamp: string; tokenHex: string }
  roomId: string
  payload: { plaintext: unknown; ciphertextB64: string }
  file: { plaintextUtf8: string; envelopeB64: string }
}

describe('relay-client crypto golden (WP-08)', () => {
  it('derives the frozen channel key, HMAC, and room id', () => {
    const { channelKeyHex } = deriveKeys(vectors.masterSecretHex)
    expect(channelKeyHex).toBe(vectors.derived.channelKeyHex)
    expect(computeHmacToken(channelKeyHex, vectors.hmac.role, vectors.hmac.timestamp)).toBe(vectors.hmac.tokenHex)
    expect(computeRoomId(channelKeyHex)).toBe(vectors.roomId)
  })

  it('decrypts unmodified desktop payload frames', () => {
    const { aesKeyBytes } = deriveKeys(vectors.masterSecretHex)
    expect(decryptPayload(aesKeyBytes, vectors.payload.ciphertextB64)).toEqual(vectors.payload.plaintext)
  })

  it('decrypts unmodified desktop chunked-file envelopes', () => {
    const { aesKeyBytes, channelKeyHex } = deriveKeys(vectors.masterSecretHex)
    const sealed = Buffer.from(vectors.file.envelopeB64, 'base64')
    expect(sealed[0]).toBe(FILE_ENVELOPE_VERSION)
    expect(sealed[1]).toBe(FILE_ENVELOPE_FORMAT_CHUNKED)
    const opened = decryptBytesChunked(aesKeyBytes, sealed, vectors.r2Key, channelKeyHex)
    expect(new TextDecoder().decode(opened)).toBe(vectors.file.plaintextUtf8)
  })

  it('round-trips payload and a small file', () => {
    const { aesKeyBytes, channelKeyHex } = deriveKeys(vectors.masterSecretHex)
    const payload = { type: 'ping', n: 7 }
    expect(decryptPayload(aesKeyBytes, encryptPayload(aesKeyBytes, payload))).toEqual(payload)
    const plain = new TextEncoder().encode('relay-client-roundtrip')
    const env = encryptBytesChunked(aesKeyBytes, plain, vectors.r2Key, channelKeyHex)
    expect(decryptBytesChunked(aesKeyBytes, env, vectors.r2Key, channelKeyHex)).toEqual(plain)
  })
})
