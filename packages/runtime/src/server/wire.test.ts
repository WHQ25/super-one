import { describe, expect, it } from 'vitest'
import { encodePlainMessage, WireDecoder, WireEncoder, WIRE_FRAGMENT_BYTES } from '@superone/shared/environment/wire'
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
})
