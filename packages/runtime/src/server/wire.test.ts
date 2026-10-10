import { describe, expect, it } from 'vitest'
import { encodePlainMessage, WireDecoder, WireEncoder, WIRE_FRAGMENT_BYTES, WIRE_HISTORY_BYTES } from '@superone/shared/environment/wire'
import { nodeWireCompression } from './wire-compression'

const randomText = (chars: number) => Array.from({ length: Math.ceil(chars / 8) }, () => Math.random().toString(36).slice(2, 10)).join('')

describe('wire framing', () => {
  it('sends small messages raw, larger ones compressed, and plain JSON before the handshake', () => {
    const encoder = new WireEncoder(nodeWireCompression)
    const decoder = new WireDecoder(nodeWireCompression)
    const [small] = encoder.encode({ a: 1 })
    expect(small![0]).toBe(0)
    const [large] = encoder.encode({ text: 'x'.repeat(5000) })
    expect(large![0]).toBe(1)
    expect(decoder.decode(small!)).toEqual({ a: 1 })
    expect(decoder.decode(large!)).toEqual({ text: 'x'.repeat(5000) })
    expect(decoder.decode(encodePlainMessage({ type: 'handshake' }))).toEqual({ type: 'handshake' })
  })

  it('reassembles fragments that interleave with other messages', () => {
    const encoder = new WireEncoder(nodeWireCompression)
    const decoder = new WireDecoder(nodeWireCompression)
    const text = randomText(4 * WIRE_FRAGMENT_BYTES)
    const parts = encoder.encode({ text })
    expect(parts.length).toBeGreaterThan(2)
    expect(parts.every((part) => part.length <= WIRE_FRAGMENT_BYTES + 9)).toBe(true)
    expect(decoder.decode(parts[0]!)).toBeUndefined()
    expect(decoder.decode(encoder.encode({ control: true })[0]!)).toEqual({ control: true })
    for (const part of parts.slice(1, -1)) expect(decoder.decode(part)).toBeUndefined()
    expect(decoder.decode(parts.at(-1)!)).toEqual({ text })
  })

  it('rejects fragments out of order', () => {
    const encoder = new WireEncoder(nodeWireCompression)
    const parts = encoder.encode({ text: randomText(4 * WIRE_FRAGMENT_BYTES) })
    expect(() => new WireDecoder(nodeWireCompression).decode(parts[1]!)).toThrow('out of order')
  })

  it('deflates pushes against the ones before them, between replies and across fragments', () => {
    const encoder = new WireEncoder(nodeWireCompression)
    const decoder = new WireDecoder(nodeWireCompression)
    const event = (n: number) => ({ type: 'stream', subscriptionId: 'a6f1c2d0-5b7e-4c3a-9d8e-1f2a3b4c5d6e', frame: { sequence: String(n), events: [{ aggregateId: '0b9c8d7e-6f5a-4b3c-2d1e-0f9a8b7c6d5e', n }] } })
    const [first] = encoder.encode(event(1), { push: true })
    const [second] = encoder.encode(event(2), { push: true })
    expect(first![0]).toBe(3)
    // The second repeats the first's keys and ids: a few bytes of back-references.
    expect(second!.length).toBeLessThan(first!.length / 2)
    expect(decoder.decode(first!)).toEqual(event(1))
    expect(decoder.decode(encoder.encode({ reply: true })[0]!)).toEqual({ reply: true })
    expect(decoder.decode(second!)).toEqual(event(2))

    // A push larger than a fragment, and one past the history window, still decode in order.
    const text = randomText(2 * WIRE_FRAGMENT_BYTES)
    const parts = encoder.encode({ text }, { push: true })
    expect(parts.length).toBeGreaterThan(1)
    let decoded: unknown
    for (const part of parts) decoded = decoder.decode(part)
    expect(decoded).toEqual({ text })
    const after = { text: randomText(WIRE_HISTORY_BYTES / 4) }
    expect(decoder.decode(encoder.encode(after, { push: true })[0]!)).toEqual(after)
  })

  it('cannot read a push without the ones before it', () => {
    const encoder = new WireEncoder(nodeWireCompression)
    const message = { text: 'shared '.repeat(200) }
    encoder.encode(message, { push: true })
    const [next] = encoder.encode(message, { push: true })
    expect(() => new WireDecoder(nodeWireCompression).decode(next!)).toThrow()
  })
})
