import { describe, it, expect } from 'vitest'
import { randomBytes as nodeRandomBytes } from 'node:crypto'
import {
  deriveKeys,
  encryptBytesChunked,
  decryptBytesChunked,
  FILE_CHUNK_SIZE,
  FILE_ENVELOPE_VERSION,
  FILE_ENVELOPE_FORMAT_CHUNKED,
} from './remote-control-crypto'

const MASTER_SECRET = '0123456789abcdef'.repeat(8)
const R2_KEY = 'files/abcdef0123456789abcdef0123456789/deadbeefcafe0001000200030004beef.bin'

async function makeKey() {
  const { aesKey, channelKeyHex } = await deriveKeys(MASTER_SECRET)
  return { aesKey, channelKeyHex }
}

function randomBytes(n: number): Uint8Array {
  return new Uint8Array(nodeRandomBytes(n))
}

describe('encryptBytesChunked / decryptBytesChunked', () => {
  it('round-trips empty plaintext', async () => {
    const { aesKey, channelKeyHex } = await makeKey()
    const plaintext = new Uint8Array(0)
    const sealed = await encryptBytesChunked(aesKey, plaintext, R2_KEY, channelKeyHex)
    expect(sealed[0]).toBe(FILE_ENVELOPE_VERSION)
    expect(sealed[1]).toBe(FILE_ENVELOPE_FORMAT_CHUNKED)
    const opened = await decryptBytesChunked(aesKey, sealed, R2_KEY, channelKeyHex)
    expect(opened.length).toBe(0)
  })

  it('round-trips small plaintext (one chunk)', async () => {
    const { aesKey, channelKeyHex } = await makeKey()
    const plaintext = randomBytes(1024)
    const sealed = await encryptBytesChunked(aesKey, plaintext, R2_KEY, channelKeyHex)
    const opened = await decryptBytesChunked(aesKey, sealed, R2_KEY, channelKeyHex)
    expect(Buffer.from(opened).equals(Buffer.from(plaintext))).toBe(true)
  })

  it('round-trips plaintext exactly at chunk boundary', async () => {
    const { aesKey, channelKeyHex } = await makeKey()
    const plaintext = randomBytes(FILE_CHUNK_SIZE)
    const sealed = await encryptBytesChunked(aesKey, plaintext, R2_KEY, channelKeyHex)
    const opened = await decryptBytesChunked(aesKey, sealed, R2_KEY, channelKeyHex)
    expect(Buffer.from(opened).equals(Buffer.from(plaintext))).toBe(true)
  })

  it('round-trips plaintext spanning multiple chunks', async () => {
    const { aesKey, channelKeyHex } = await makeKey()
    const plaintext = randomBytes(FILE_CHUNK_SIZE * 2 + 17)
    const sealed = await encryptBytesChunked(aesKey, plaintext, R2_KEY, channelKeyHex)
    const opened = await decryptBytesChunked(aesKey, sealed, R2_KEY, channelKeyHex)
    expect(opened.length).toBe(plaintext.length)
    expect(Buffer.from(opened).equals(Buffer.from(plaintext))).toBe(true)
  })

  it('emits ciphertext that does not contain plaintext canary', async () => {
    const { aesKey, channelKeyHex } = await makeKey()
    const canary = Buffer.from('ANTHROPIC_PLAINTEXT_CANARY_DO_NOT_LEAK')
    const plaintext = new Uint8Array(canary.length + 4096)
    plaintext.set(canary, 0)
    plaintext.set(randomBytes(4096), canary.length)
    const sealed = await encryptBytesChunked(aesKey, plaintext, R2_KEY, channelKeyHex)
    const sealedHex = Buffer.from(sealed).toString('hex')
    expect(sealedHex.includes(canary.toString('hex'))).toBe(false)
  })

  it('rejects tampered ciphertext byte', async () => {
    const { aesKey, channelKeyHex } = await makeKey()
    const plaintext = randomBytes(2048)
    const sealed = await encryptBytesChunked(aesKey, plaintext, R2_KEY, channelKeyHex)
    sealed[40] ^= 0x01
    await expect(decryptBytesChunked(aesKey, sealed, R2_KEY, channelKeyHex)).rejects.toThrow()
  })

  it('rejects tampered IV', async () => {
    const { aesKey, channelKeyHex } = await makeKey()
    const plaintext = randomBytes(2048)
    const sealed = await encryptBytesChunked(aesKey, plaintext, R2_KEY, channelKeyHex)
    sealed[16] ^= 0x80
    await expect(decryptBytesChunked(aesKey, sealed, R2_KEY, channelKeyHex)).rejects.toThrow()
  })

  it('rejects mismatched r2Key (AAD binding)', async () => {
    const { aesKey, channelKeyHex } = await makeKey()
    const plaintext = randomBytes(1024)
    const sealed = await encryptBytesChunked(aesKey, plaintext, R2_KEY, channelKeyHex)
    await expect(
      decryptBytesChunked(aesKey, sealed, R2_KEY + 'x', channelKeyHex),
    ).rejects.toThrow()
  })

  it('rejects mismatched channelKeyHex (AAD binding)', async () => {
    const { aesKey, channelKeyHex } = await makeKey()
    const plaintext = randomBytes(1024)
    const sealed = await encryptBytesChunked(aesKey, plaintext, R2_KEY, channelKeyHex)
    const otherChannelKey = channelKeyHex.replace(/.$/, (c) => (c === '0' ? '1' : '0'))
    await expect(
      decryptBytesChunked(aesKey, sealed, R2_KEY, otherChannelKey),
    ).rejects.toThrow()
  })

  it('rejects truncated envelope', async () => {
    const { aesKey, channelKeyHex } = await makeKey()
    const plaintext = randomBytes(1024)
    const sealed = await encryptBytesChunked(aesKey, plaintext, R2_KEY, channelKeyHex)
    const truncated = sealed.subarray(0, sealed.length - 5)
    await expect(decryptBytesChunked(aesKey, truncated, R2_KEY, channelKeyHex)).rejects.toThrow()
  })

  it('rejects unsupported version byte', async () => {
    const { aesKey, channelKeyHex } = await makeKey()
    const plaintext = randomBytes(64)
    const sealed = await encryptBytesChunked(aesKey, plaintext, R2_KEY, channelKeyHex)
    sealed[0] = 0xff
    await expect(decryptBytesChunked(aesKey, sealed, R2_KEY, channelKeyHex)).rejects.toThrow(/version/)
  })
})
