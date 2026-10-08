import { expect, it } from 'vitest'
import { decodeHostPlaintext } from '@superone/relay-client/host-payload'
import { frameHostPayload } from './payload-codec'

it('frames raw and deflated payloads the phone decodes, with measurable savings', async () => {
  for (const payload of [{ ok: true }, { text: '多语言 payload '.repeat(5000) }]) {
    const framed = await frameHostPayload(payload)
    expect(decodeHostPlaintext(framed)).toEqual(payload)
    if ('text' in payload) expect(framed.length).toBeLessThan(1500)
    else expect(framed[0]).toBe(0)
  }
})
