/**
 * Message framing inside the node channel from protocol generation 3. A
 * message is its JSON in the remote payload frame (`remote-payload.ts`):
 * DEFLATE above {@link WIRE_COMPRESS_MIN_BYTES}, raw otherwise. A frame larger
 * than {@link WIRE_FRAGMENT_BYTES} travels as fragments, so the sender can put
 * control messages between the parts of a large result. Frames exchanged
 * before the generation handshake are plain JSON, so a peer of another
 * generation can still read the refusal.
 * Format: docs/architecture/remote-node-service.md (wire framing).
 *
 * Compression is injected: Node uses zlib, Expo a pure-JS inflater.
 */

import {
  decodeRemotePayload,
  frameRemotePayload,
  MAX_REMOTE_PAYLOAD_BYTES,
  REMOTE_PAYLOAD_HEADER_BYTES,
  type RemotePayloadInflate,
} from '../remote-payload'

export interface WireCompression {
  deflate(json: Uint8Array): Uint8Array
  inflate: RemotePayloadInflate
}

export const WIRE_COMPRESS_MIN_BYTES = 512
export const WIRE_FRAGMENT_BYTES = 256 * 1024

const FRAGMENT_FLAG = 2
/** Flag, message id (u32), index (u16), total (u16). */
const FRAGMENT_HEADER_BYTES = 9
const MAX_FRAGMENTS = Math.ceil((MAX_REMOTE_PAYLOAD_BYTES + REMOTE_PAYLOAD_HEADER_BYTES) / WIRE_FRAGMENT_BYTES)
const JSON_OPEN_BRACE = 0x7b

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

/** A pre-handshake frame: plain JSON. */
export function encodePlainMessage(message: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(message))
}

/** Splits outgoing messages into frames; message ids are per connection and direction. */
export class WireEncoder {
  private nextId = 0

  constructor(private readonly compression: Pick<WireCompression, 'deflate'>) {}

  encode(message: unknown): Uint8Array[] {
    const json = encoder.encode(JSON.stringify(message))
    const frame = frameRemotePayload(json, json.length > WIRE_COMPRESS_MIN_BYTES ? this.compression.deflate(json) : undefined)
    if (frame.length <= WIRE_FRAGMENT_BYTES) return [frame]
    const id = this.nextId = (this.nextId + 1) >>> 0
    const total = Math.ceil(frame.length / WIRE_FRAGMENT_BYTES)
    const parts: Uint8Array[] = []
    for (let index = 0; index < total; index++) {
      const slice = frame.subarray(index * WIRE_FRAGMENT_BYTES, (index + 1) * WIRE_FRAGMENT_BYTES)
      const part = new Uint8Array(FRAGMENT_HEADER_BYTES + slice.length)
      const view = new DataView(part.buffer)
      part[0] = FRAGMENT_FLAG
      view.setUint32(1, id)
      view.setUint16(5, index)
      view.setUint16(7, total)
      part.set(slice, FRAGMENT_HEADER_BYTES)
      parts.push(part)
    }
    return parts
  }
}

/**
 * Reads incoming frames back into messages. Fragments of one message arrive
 * in order but may interleave with other messages; one message is assembled
 * at a time per id, bounded by the payload limit.
 */
export class WireDecoder {
  private readonly partial = new Map<number, { total: number; parts: Uint8Array[]; bytes: number }>()
  private partialBytes = 0

  constructor(private readonly compression: Pick<WireCompression, 'inflate'>) {}

  /** The message a frame completes, or `undefined` while fragments are outstanding. */
  decode(frame: Uint8Array): unknown {
    if (frame[0] === JSON_OPEN_BRACE) return JSON.parse(decoder.decode(frame))
    if (frame[0] !== FRAGMENT_FLAG) return decodeRemotePayload(frame, this.compression.inflate)
    if (frame.length <= FRAGMENT_HEADER_BYTES) throw new Error('empty wire fragment')
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    const id = view.getUint32(1)
    const index = view.getUint16(5)
    const total = view.getUint16(7)
    if (total < 2 || total > MAX_FRAGMENTS) throw new Error(`invalid wire fragment total: ${total}`)
    const entry = this.partial.get(id) ?? { total, parts: [], bytes: 0 }
    if (entry.total !== total || index !== entry.parts.length) throw new Error('wire fragment out of order')
    const body = frame.subarray(FRAGMENT_HEADER_BYTES)
    entry.parts.push(body)
    entry.bytes += body.length
    this.partialBytes += body.length
    if (this.partialBytes > MAX_REMOTE_PAYLOAD_BYTES + REMOTE_PAYLOAD_HEADER_BYTES) throw new Error('wire fragments exceed the payload limit')
    this.partial.set(id, entry)
    if (entry.parts.length < total) return undefined
    this.partial.delete(id)
    this.partialBytes -= entry.bytes
    const whole = new Uint8Array(entry.bytes)
    let offset = 0
    for (const part of entry.parts) {
      whole.set(part, offset)
      offset += part.length
    }
    return decodeRemotePayload(whole, this.compression.inflate)
  }
}
