import type { SecureChannel } from '@superone/relay-client/secure-channel'
import { encodePlainMessage, WireDecoder, WireEncoder } from '@superone/shared/environment/wire'
import type { EventStreamFlow } from './event-stream'
import type { NodeSocket } from './node-socket'
import { nodeWireCompression } from './wire-compression'
import { WireOutbox } from './wire-outbox'

/** Held stream bytes per connection before a session's streaming events give way to `resnapshot`. */
export const STREAM_BUDGET_BYTES = 4 * 1024 * 1024

/**
 * How one connection's messages become socket frames, either way. A plain
 * socket carries JSON text. A channel carries sealed frames: plain JSON until
 * the generation handshake, wire frames (`@superone/shared/environment/wire`)
 * after it. Frames are sealed as they leave the outbox, so channel sequence
 * numbers follow the socket order.
 */
export interface ConnectionWire {
  /** RPC replies and control: ahead of stream frames. */
  reply(message: unknown): void
  /** Stream frames. */
  push(message: unknown): void
  /** Generation 3 is agreed: later messages travel as wire frames. */
  startFraming(): void
  /** The message a received frame completes; `undefined` while a message is still in fragments. */
  read(data: Buffer, isBinary: boolean): unknown
  flow: EventStreamFlow
  close(): void
}

export function createConnectionWire(ws: NodeSocket, channel: SecureChannel | null): ConnectionWire {
  const outbox = new WireOutbox({
    write: (frame) => ws.send(channel ? channel.sealBytes(frame as Uint8Array) : frame),
    buffered: () => ws.bufferedAmount,
  })
  const encoder = new WireEncoder(nodeWireCompression)
  const decoder = new WireDecoder(nodeWireCompression)
  let framing = false
  const encode = (message: unknown, push: boolean): Array<string | Uint8Array> => {
    if (!channel) return [JSON.stringify(message)]
    return framing ? encoder.encode(message, { push }) : [encodePlainMessage(message)]
  }
  return {
    reply: (message) => outbox.send(encode(message, false), 'control'),
    // The stream lane keeps its order, which the push history needs.
    push: (message) => outbox.send(encode(message, true), 'stream'),
    startFraming: () => { framing = true },
    read: (data, isBinary) => {
      if (!channel) return JSON.parse(data.toString())
      if (!isBinary) throw new Error('expected a sealed binary frame')
      return decoder.decode(channel.openBytes(data))
    },
    flow: {
      congested: () => outbox.congested(),
      onDrain: (listener) => outbox.onDrain(listener),
      budgetBytes: STREAM_BUDGET_BYTES,
    },
    close: () => outbox.close(),
  }
}
