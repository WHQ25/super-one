/**
 * Message framing inside the node channel from protocol generation 3. A
 * message is its JSON in the remote payload frame (`remote-payload.ts`):
 * DEFLATE above {@link WIRE_COMPRESS_MIN_BYTES}; small RPC receipts can also
 * use schema compression when it saves bytes. Control
 * messages use the generation's frozen schema dictionary; unlike pushes,
 * they can overtake pending stream frames. Pushed
 * messages (the stream lane) instead deflate against the last
 * {@link WIRE_HISTORY_BYTES} of the pushes before them, which both ends keep,
 * so the keys and ids every event repeats cost a back-reference. A frame larger
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
} from '../remote-payload'
import { WIRE_SCHEMA_DICTIONARY } from './wire-dictionary'

export interface WireCompression {
  /** Raw DEFLATE, primed with `dictionary` when given. */
  deflate(json: Uint8Array, dictionary?: Uint8Array): Uint8Array
  /** Raw INFLATE into a buffer of the authenticated size, primed like the deflate. */
  inflate(body: Uint8Array, out: Uint8Array, dictionary?: Uint8Array): Uint8Array
}

export const WIRE_COMPRESS_MIN_BYTES = 512
export const WIRE_FRAGMENT_BYTES = 256 * 1024

/** DEFLATE's window: the pushed plaintext a pushed message may refer back to. */
export const WIRE_HISTORY_BYTES = 32 * 1024

const FRAGMENT_FLAG = 2
/** A pushed message, deflated against the push history; header as the remote payload's. */
const HISTORY_FLAG = 3
/** A control reply deflated against the generation's frozen schema vocabulary. */
const SCHEMA_FLAG = 4
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

/** The last {@link WIRE_HISTORY_BYTES} of pushed plaintext, kept alike on both ends. */
class PushHistory {
  bytes = new Uint8Array(0)

  append(json: Uint8Array): void {
    const keep = Math.min(this.bytes.length, WIRE_HISTORY_BYTES - Math.min(json.length, WIRE_HISTORY_BYTES))
    const next = new Uint8Array(keep + Math.min(json.length, WIRE_HISTORY_BYTES))
    next.set(this.bytes.subarray(this.bytes.length - keep))
    next.set(json.subarray(json.length - (next.length - keep)), keep)
    this.bytes = next
  }
}

/**
 * Splits outgoing messages into frames; message ids are per connection and
 * direction. Pushes must reach the decoder in the order they were encoded.
 */
export class WireEncoder {
  private nextId = 0
  private readonly history = new PushHistory()

  constructor(private readonly compression: Pick<WireCompression, 'deflate'>) {}

  encode(message: unknown, opts: { push?: boolean } = {}): Uint8Array[] {
    const json = encoder.encode(JSON.stringify(message))
    if (json.length > MAX_REMOTE_PAYLOAD_BYTES) throw new Error('remote payload exceeds 32 MiB')
    const frame = opts.push ? this.pushFrame(json) : this.controlFrame(json, message)
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

  private controlFrame(json: Uint8Array, message: unknown): Uint8Array {
    if (json.length <= WIRE_COMPRESS_MIN_BYTES && (message as { type?: string } | null)?.type !== 'rpc_result') return frameRemotePayload(json)
    const schema = this.compression.deflate(json, WIRE_SCHEMA_DICTIONARY)
    if (schema.length >= json.length) return frameRemotePayload(json)
    const frame = frameRemotePayload(json, schema)
    frame[0] = SCHEMA_FLAG
    return frame
  }

  private pushFrame(json: Uint8Array): Uint8Array {
    const body = this.compression.deflate(json, this.history.bytes.length ? this.history.bytes : undefined)
    this.history.append(json)
    const frame = new Uint8Array(REMOTE_PAYLOAD_HEADER_BYTES + body.length)
    frame[0] = HISTORY_FLAG
    new DataView(frame.buffer).setUint32(1, json.length)
    frame.set(body, REMOTE_PAYLOAD_HEADER_BYTES)
    return frame
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
  private readonly history = new PushHistory()

  constructor(private readonly compression: Pick<WireCompression, 'inflate'>) {}

  /** The message a frame completes, or `undefined` while fragments are outstanding. */
  decode(frame: Uint8Array): unknown {
    if (frame[0] === JSON_OPEN_BRACE) return JSON.parse(decoder.decode(frame))
    if (frame[0] !== FRAGMENT_FLAG) return this.payload(frame)
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
    return this.payload(whole)
  }

  private payload(frame: Uint8Array): unknown {
    if (frame[0] === SCHEMA_FLAG) {
      // Reuse the same bounded payload validation, with this flag's dictionary.
      const standard = frame.slice()
      standard[0] = 1
      return decodeRemotePayload(standard, (body, out) => this.compression.inflate(body, out, WIRE_SCHEMA_DICTIONARY))
    }
    if (frame[0] !== HISTORY_FLAG) return decodeRemotePayload(frame, (body, out) => this.compression.inflate(body, out))
    if (frame.length < REMOTE_PAYLOAD_HEADER_BYTES) throw new Error('invalid remote payload length')
    const size = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1)
    if (size > MAX_REMOTE_PAYLOAD_BYTES) throw new Error('remote payload exceeds 32 MiB')
    const json = this.compression.inflate(frame.subarray(REMOTE_PAYLOAD_HEADER_BYTES), new Uint8Array(size + 1), this.history.bytes.length ? this.history.bytes : undefined)
    if (json.length !== size) throw new Error('remote payload size mismatch')
    this.history.append(json)
    return JSON.parse(decoder.decode(json))
  }
}
