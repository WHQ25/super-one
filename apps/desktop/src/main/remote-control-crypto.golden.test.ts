import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  computeHmacToken,
  computeRoomId,
  decryptBytesChunked,
  decryptPayload,
  deriveKeys,
  FILE_ENVELOPE_FORMAT_CHUNKED,
  FILE_ENVELOPE_VERSION,
} from './remote-control-crypto'

const vectors = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/design/relay-crypto-golden/vectors.json'),
    'utf8',
  ),
) as {
  masterSecretHex: string
  r2Key: string
  derived: { channelKeyHex: string }
  hmac: { role: string; timestamp: string; tokenHex: string }
  roomId: string
  payload: { plaintext: unknown; ciphertextB64: string }
  file: { plaintextUtf8: string; envelopeB64: string }
}

describe('remote-control crypto golden vectors (WP-03)', () => {
  it('derives the frozen channel key, HMAC token, and room id', async () => {
    const { channelKeyHex } = await deriveKeys(vectors.masterSecretHex)
    expect(channelKeyHex).toBe(vectors.derived.channelKeyHex)
    expect(await computeHmacToken(channelKeyHex, vectors.hmac.role, vectors.hmac.timestamp)).toBe(vectors.hmac.tokenHex)
    expect(await computeRoomId(channelKeyHex)).toBe(vectors.roomId)
  })

  it('decrypts the captured payload envelope with no crypto.ts edits', async () => {
    const { aesKey } = await deriveKeys(vectors.masterSecretHex)
    await expect(decryptPayload(aesKey, vectors.payload.ciphertextB64)).resolves.toEqual(vectors.payload.plaintext)
  })

  it('decrypts the captured chunked-file envelope with no crypto.ts edits', async () => {
    const { aesKey, channelKeyHex } = await deriveKeys(vectors.masterSecretHex)
    const sealed = Buffer.from(vectors.file.envelopeB64, 'base64')
    expect(sealed[0]).toBe(FILE_ENVELOPE_VERSION)
    expect(sealed[1]).toBe(FILE_ENVELOPE_FORMAT_CHUNKED)
    const opened = await decryptBytesChunked(aesKey, sealed, vectors.r2Key, channelKeyHex)
    expect(new TextDecoder().decode(opened)).toBe(vectors.file.plaintextUtf8)
  })
})
