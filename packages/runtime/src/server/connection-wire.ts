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
  read(data: Uint8Array, isBinary: boolean): unknown
  flow: EventStreamFlow
  close(): void
}

export function createConnectionWire(ws: NodeSocket, channel: SecureChannel | null): ConnectionWire {
  if (!channel) {
    // A plain socket: JSON text both ways, never framed.
    const outbox = new WireOutbox({ write: (frame) => ws.send(frame), buffered: () => ws.bufferedAmount })
    return {
      reply: (message) => outbox.send([JSON.stringify(message)], 'control'),
      push: (message) => outbox.send([JSON.stringify(message)], 'stream'),
      startFraming: () => {},
      read: (data) => JSON.parse(Buffer.from(data).toString()),
      flow: outboxFlow(outbox),
      close: () => outbox.close(),
    }
  }
  const wire = createFramedWire({
    write: (frame) => ws.send(channel.sealBytes(frame)),
    buffered: () => ws.bufferedAmount,
  })
  return {
    ...wire,
    read: (data, isBinary) => {
      if (!isBinary) throw new Error('expected a sealed binary frame')
      return wire.read(channel.openBytes(data), true)
    },
  }
}

/** Where a framed wire's frames go: a transport that seals each one for its channel. */
export interface FrameTransport {
  write(frame: Uint8Array): void
  /** Bytes the transport still holds, for the outbox's high-water mark. */
  buffered(): number
}

/**
 * A connection's wire over any sealed transport (a node channel, a phone
 * link): plain JSON messages until the generation handshake, wire frames
 * after it. `read` takes the opened bytes of one received frame.
 */
export function createFramedWire(transport: FrameTransport): ConnectionWire {
  const outbox = new WireOutbox({
    // A framed wire only ever queues bytes.
    write: (frame) => transport.write(frame as Uint8Array),
    buffered: transport.buffered,
  })
  const encoder = new WireEncoder(nodeWireCompression)
  const decoder = new WireDecoder(nodeWireCompression)
  let framing = false
  const encode = (message: unknown, push: boolean): Uint8Array[] =>
    framing ? encoder.encode(message, { push }) : [encodePlainMessage(message)]
  return {
    reply: (message) => outbox.send(encode(message, false), 'control'),
    // The stream lane keeps its order, which the push history needs.
    push: (message) => outbox.send(encode(message, true), 'stream'),
    startFraming: () => { framing = true },
    read: (data) => decoder.decode(data),
    flow: outboxFlow(outbox),
    close: () => outbox.close(),
  }
}

function outboxFlow(outbox: WireOutbox): EventStreamFlow {
  return {
    congested: () => outbox.congested(),
    onDrain: (listener) => outbox.onDrain(listener),
    budgetBytes: STREAM_BUDGET_BYTES,
  }
}
