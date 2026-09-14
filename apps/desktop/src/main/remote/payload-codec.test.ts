import { expect, it } from 'vitest'
import { deriveKeys } from '../remote-control-crypto'
import { encryptHostPayload } from './payload-codec'
import { decryptHostPayload, deriveKeys as mobileKeys } from '@superone/relay-client/crypto'

const secret = '0123456789abcdef'.repeat(8)
it('roundtrips host raw and deflated frames through the phone codec with measurable wire savings', async () => {
  const host = await deriveKeys(secret)
  const mobile = mobileKeys(secret)
  for (const payload of [{ ok: true }, { text: '多语言 payload '.repeat(5000) }]) {
    const encrypted = await encryptHostPayload(host.aesKey, payload)
    expect(decryptHostPayload(mobile.aesKeyBytes, encrypted)).toEqual(payload)
    if ('text' in payload) expect(encrypted.length).toBeLessThan(2000)
  }
})
