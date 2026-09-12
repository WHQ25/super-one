import { afterEach, describe, expect, it } from 'vitest'
import { decryptPayload, encryptPayload, decryptBytesChunked, encryptBytesChunked } from './crypto'
import { jsBase64, nobleAesGcm, setCryptoBackend, type AesGcm } from './crypto-backend'

const key = new Uint8Array(32).map((_, i) => i)

afterEach(() => setCryptoBackend(null))

describe('the swappable AES-GCM backend', () => {
  it('routes payload and file envelopes through an installed implementation', () => {
    const calls: string[] = []
    const spy: AesGcm = {
      seal: (k, iv, plaintext, aad) => { calls.push(`seal:${aad ? 'aad' : '-'}`); return nobleAesGcm.seal(k, iv, plaintext, aad) },
      open: (k, iv, sealed, aad) => { calls.push(`open:${aad ? 'aad' : '-'}`); return nobleAesGcm.open(k, iv, sealed, aad) },
    }
    setCryptoBackend({ aesGcm: spy })
    expect(decryptPayload(key, encryptPayload(key, { hello: 'world' }))).toEqual({ hello: 'world' })
    const bytes = new Uint8Array([1, 2, 3])
    expect(decryptBytesChunked(key, encryptBytesChunked(key, bytes, 'r2', 'ck'), 'r2', 'ck')).toEqual(bytes)
    expect(calls).toEqual(['seal:-', 'open:-', 'seal:aad', 'open:aad'])
  })

  it('keeps the JS default for whatever the backend leaves out', () => {
    const encoded: string[] = []
    setCryptoBackend({ base64: { encode: (b) => { const s = jsBase64.encode(b); encoded.push(s); return s }, decode: jsBase64.decode } })
    const frame = encryptPayload(key, 'x')
    expect(encoded).toEqual([frame])
    expect(decryptPayload(key, frame)).toBe('x')
  })

  it('base64 round-trips without Buffer, in chunks larger than one apply call', () => {
    const bytes = new Uint8Array(20_000).map((_, i) => (i * 7) & 0xff)
    const saved = globalThis.Buffer
    // @ts-expect-error simulate Hermes
    globalThis.Buffer = undefined
    try {
      expect(jsBase64.decode(jsBase64.encode(bytes))).toEqual(bytes)
    } finally {
      globalThis.Buffer = saved
    }
  })
})
