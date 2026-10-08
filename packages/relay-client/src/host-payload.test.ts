import { deflateRawSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { frameRemotePayload, MAX_REMOTE_PAYLOAD_BYTES } from '@superone/shared/remote-payload'
import { decodeHostPlaintext } from './host-payload'
import { readFileSync } from 'node:fs'
import { deriveKeys } from './crypto'
import { aesGcm, base64 } from './crypto-backend'

it('decodes frozen raw and deflated host frames', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/host-payload-v1.json', import.meta.url), 'utf8'))
  const keys = deriveKeys(fixture.masterSecretHex)
  for (const vector of fixture.vectors) {
    // The vectors seal the frame under a static key; the frame inside is what is pinned.
    const sealed = base64().decode(vector.ciphertextB64)
    const frame = aesGcm().open(keys.aesKeyBytes, sealed.subarray(0, 12), sealed.subarray(12))
    expect(frame[0]).toBe(vector.flag)
    expect(decodeHostPlaintext(frame)).toEqual(vector.plaintext)
  }
})

it('rejects unknown flags, bad streams, size lies and excessive output declarations', () => {
  const json = new TextEncoder().encode(JSON.stringify({ text: 'x'.repeat(10000) }))
  const frame = frameRemotePayload(json, deflateRawSync(json))
  expect(decodeHostPlaintext(frame)).toEqual({ text: 'x'.repeat(10000) })
  const unknown = frame.slice(); unknown[0] = 2
  expect(() => decodeHostPlaintext(unknown)).toThrow('flag')
  const huge = frame.slice(); new DataView(huge.buffer).setUint32(1, MAX_REMOTE_PAYLOAD_BYTES + 1)
  expect(() => decodeHostPlaintext(huge)).toThrow('32 MiB')
  const small = frame.slice(); new DataView(small.buffer).setUint32(1, 10)
  expect(() => decodeHostPlaintext(small)).toThrow('size mismatch')
  expect(() => decodeHostPlaintext(frame.subarray(0, 8))).toThrow()
  expect(() => decodeHostPlaintext(new Uint8Array())).toThrow('length')
})

it('falls back to raw when compression grows the payload', () => {
  const json = new TextEncoder().encode('{}')
  const frame = frameRemotePayload(json, deflateRawSync(json))
  expect(frame[0]).toBe(0)
  expect(decodeHostPlaintext(frame)).toEqual({})
})
