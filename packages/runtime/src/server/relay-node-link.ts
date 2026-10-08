import { EventEmitter } from 'node:events'
import { createHmac, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { createRelayHeartbeat } from '@superone/shared/relay-heartbeat'
import { REMOTE_RESPONSE_CHUNK_CHARS } from '@superone/shared/remote-payload'
import { MAX_NODE_FRAME_BYTES, type NodeSocket, type NodeSocketDialer } from './node-socket'

/**
 * The node channel over the relay (`apps/relay`), in the phone link's framing.
 * The node holds the room's `desktop` socket; every client connection takes a
 * fresh `mobile` slot in that room, so the relay routes each connection's
 * frames separately. Each socket-level frame of the channel becomes one
 * `channel` envelope: handshake text frames as `msg`, sealed binary frames as
 * base64 `data`, split into `more`-flagged parts under the relay's frame size.
 * The relay sees the room id, slot ids, the key id in the hello and frame
 * sizes; the channel keys never leave the two ends.
 * Format: docs/architecture/relay-crypto.md (node channel over the relay).
 */

export const NODE_RELAY_SLOT_PREFIX = 'node-'
const MAX_DATA_CHARS = Math.ceil(MAX_NODE_FRAME_BYTES / 3) * 4

/** Relay room of a node, derived from its channel root; reveals nothing about the root. */
export function nodeRelayRoomId(channelRootHex: string): string {
  return createHmac('sha256', Buffer.from(channelRootHex, 'hex'))
    .update('superone-channel/v1|relay-room')
    .digest('hex')
    .slice(0, 32)
}

export interface NodeRelayEnvelope {
  type: 'channel'
  msg?: unknown
  data?: string
  more?: true
}

/** A frame the relay delivered: a channel envelope, a peer event, or a slot close. */
type RelayInbound = Omit<Partial<NodeRelayEnvelope>, 'type'> & { type?: unknown; mobileDeviceId?: unknown; code?: unknown; reason?: unknown }

/** Turn one socket-level frame into the envelopes that carry it. */
export function encodeNodeRelayFrame(data: string | Uint8Array): NodeRelayEnvelope[] {
  if (typeof data === 'string') return [{ type: 'channel', msg: JSON.parse(data) as unknown }]
  const b64 = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64')
  const parts: NodeRelayEnvelope[] = []
  for (let i = 0; i < b64.length; i += REMOTE_RESPONSE_CHUNK_CHARS) {
    const end = i + REMOTE_RESPONSE_CHUNK_CHARS
    parts.push({ type: 'channel', data: b64.slice(i, end), ...(end < b64.length ? { more: true as const } : {}) })
  }
  return parts.length > 0 ? parts : [{ type: 'channel', data: '' }]
}

/**
 * One end of a channel connection carried by relay envelopes. It behaves like
 * a `ws` socket: `message` with `(Buffer, isBinary)`, `close` with
 * `(code, reason)`, and `send` of a text or binary frame.
 */
export class RelaySlotSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING
  private pending = ''

  constructor(
    /** Sends one envelope; false when the relay socket is gone. */
    private readonly write: (envelope: NodeRelayEnvelope) => boolean,
    /** This end closed the connection; tell the peer and release the slot. */
    private readonly onLocalClose: (code: number, reason: string) => void,
  ) {
    super()
  }

  asNodeSocket(): NodeSocket {
    return this as unknown as NodeSocket
  }

  markOpen(): void {
    if (this.readyState !== WebSocket.CONNECTING) return
    this.readyState = WebSocket.OPEN
    this.emit('open')
  }

  send(data: string | Uint8Array): void {
    if (this.readyState !== WebSocket.OPEN) throw new Error('relay slot is not open')
    for (const envelope of encodeNodeRelayFrame(data)) {
      if (!this.write(envelope)) {
        this.remoteClose(1006, 'relay_unavailable')
        throw new Error('relay is not connected')
      }
    }
  }

  close(code = 1000, reason = ''): void {
    if (this.finish(code, reason)) this.onLocalClose(code, reason)
  }

  /** The peer, the relay or the relay socket ended this connection. */
  remoteClose(code: number, reason: string): void {
    this.finish(code, reason)
  }

  /** Deliver an envelope from the peer. */
  receive(envelope: NodeRelayEnvelope): void {
    if (this.readyState !== WebSocket.OPEN) return
    if (envelope.msg !== undefined) {
      this.emit('message', Buffer.from(JSON.stringify(envelope.msg)), false)
      return
    }
    if (typeof envelope.data !== 'string') return
    this.pending += envelope.data
    if (this.pending.length > MAX_DATA_CHARS) {
      this.close(1009, 'frame_too_large')
      return
    }
    if (envelope.more) return
    const frame = Buffer.from(this.pending, 'base64')
    this.pending = ''
    this.emit('message', frame, true)
  }

  private finish(code: number, reason: string): boolean {
    if (this.readyState === WebSocket.CLOSED) return false
    this.readyState = WebSocket.CLOSED
    this.pending = ''
    // `ws` reports close asynchronously; callers rely on that ordering.
    setImmediate(() => this.emit('close', code, Buffer.from(reason)))
    return true
  }
}

function relaySocketUrl(relayUrl: string, params: Record<string, string>): string {
  const query = new URLSearchParams({ ...params, ts: String(Date.now()) })
  return `${relayUrl.replace(/\/+$/, '')}/ws?${query}`
}

function parseInbound(raw: WebSocket.RawData): RelayInbound | null {
  try {
    const frame = JSON.parse(raw.toString()) as unknown
    return frame && typeof frame === 'object' ? (frame as RelayInbound) : null
  } catch {
    return null
  }
}

/**
 * Client side: each dial opens a new relay slot in the node's room. The node's
 * `/ws` URL is ignored; the slot is the connection. A node that reconnects to
 * the relay (`peer_connected`) or leaves it has lost this connection's channel,
 * so the slot closes.
 */
export function createRelayNodeDialer(input: { relayUrl: string; roomId: string }): NodeSocketDialer {
  return () => {
    const slotId = `${NODE_RELAY_SLOT_PREFIX}${randomUUID()}`
    const ws = new WebSocket(relaySocketUrl(input.relayUrl, { role: 'mobile', room: input.roomId, deviceId: slotId }))
    const heartbeat = createRelayHeartbeat({ send: (text) => ws.send(text), onTimeout: () => ws.terminate() })
    const socket = new RelaySlotSocket(
      (envelope) => {
        if (ws.readyState !== WebSocket.OPEN) return false
        ws.send(JSON.stringify(envelope))
        return true
      },
      () => {
        heartbeat.stop()
        ws.close(1000, 'closed')
      },
    )
    ws.on('open', () => {
      heartbeat.start()
      socket.markOpen()
    })
    ws.on('message', (raw) => {
      if (heartbeat.onMessage(raw.toString())) return
      const frame = parseInbound(raw)
      if (!frame) return
      switch (frame.type) {
        case 'channel':
          socket.receive(frame as NodeRelayEnvelope)
          return
        case 'kicked':
          socket.remoteClose(typeof frame.code === 'number' ? frame.code : 4401, typeof frame.reason === 'string' ? frame.reason : 'kicked')
          ws.close(1000, 'closed')
          return
        case 'peer_connected':
        case 'peer_disconnected':
        case 'desktop_shutdown':
          socket.remoteClose(4404, 'node_left_relay')
          ws.close(1000, 'closed')
      }
    })
    ws.on('error', (err) => {
      if (socket.listenerCount('error') > 0) socket.emit('error', err)
    })
    ws.on('close', (code, reason) => {
      heartbeat.stop()
      socket.remoteClose(code === 1000 ? 1006 : code, reason.toString() || 'relay_closed')
    })
    return socket.asNodeSocket()
  }
}

export interface RelayNodeHostOptions {
  relayUrl: string
  roomId: string
  /** A client opened a connection; the node serves its encrypted channel on it. */
  onSocket: (socket: NodeSocket) => void
  onStatus?: (connected: boolean) => void
  log?: { info: (message: string) => void; warn: (message: string) => void }
  /** Reconnect backoff; defaults 1 s doubling to 30 s. */
  minDelayMs?: number
  maxDelayMs?: number
}

/**
 * Node side: keeps the room's `desktop` socket open while node access is on
 * and turns each client slot into a socket for the node server.
 */
export class RelayNodeHost {
  private ws: WebSocket | null = null
  private readonly slots = new Map<string, RelaySlotSocket>()
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private delay: number

  constructor(private readonly opts: RelayNodeHostOptions) {
    this.delay = opts.minDelayMs ?? 1_000
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const slot of [...this.slots.values()]) slot.close(1001, 'node_stopping')
    this.slots.clear()
    const ws = this.ws
    this.ws = null
    ws?.close(1000, 'stopping')
  }

  private connect(): void {
    const ws = new WebSocket(relaySocketUrl(this.opts.relayUrl, { role: 'desktop', room: this.opts.roomId }))
    this.ws = ws
    const heartbeat = createRelayHeartbeat({
      send: (text) => ws.send(text),
      onTimeout: () => {
        this.opts.log?.warn('[node-relay] heartbeat timed out')
        ws.terminate()
      },
    })
    ws.on('open', () => {
      this.delay = this.opts.minDelayMs ?? 1_000
      heartbeat.start()
      this.opts.log?.info('[node-relay] connected')
      this.opts.onStatus?.(true)
    })
    ws.on('message', (raw) => {
      if (heartbeat.onMessage(raw.toString())) return
      const frame = parseInbound(raw)
      if (frame) this.handle(frame)
    })
    ws.on('error', (err) => this.opts.log?.warn(`[node-relay] ${err.message}`))
    ws.on('close', () => {
      heartbeat.stop()
      if (this.ws !== ws) return
      this.ws = null
      for (const slot of this.slots.values()) slot.remoteClose(1006, 'relay_closed')
      this.slots.clear()
      this.opts.onStatus?.(false)
      if (!this.stopped) this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.timer) return
    const delay = this.delay
    this.delay = Math.min(this.delay * 2, this.opts.maxDelayMs ?? 30_000)
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.stopped) this.connect()
    }, delay)
    this.timer.unref?.()
  }

  private handle(frame: RelayInbound): void {
    const slotId = typeof frame.mobileDeviceId === 'string' ? frame.mobileDeviceId : null
    switch (frame.type) {
      case 'channel': {
        if (!slotId?.startsWith(NODE_RELAY_SLOT_PREFIX)) return
        let slot = this.slots.get(slotId)
        if (!slot) {
          // Only a hello opens a connection; other frames belong to one already gone.
          if ((frame.msg as { type?: unknown } | undefined)?.type !== 'channel_hello') return
          slot = this.openSlot(slotId)
        }
        slot.receive(frame as NodeRelayEnvelope)
        return
      }
      case 'peer_connected':
      case 'peer_disconnected':
        if (slotId) {
          this.slots.get(slotId)?.remoteClose(1001, 'client_left_relay')
          this.slots.delete(slotId)
        } else if (frame.type === 'peer_disconnected') {
          for (const slot of this.slots.values()) slot.remoteClose(1001, 'client_left_relay')
          this.slots.clear()
        }
    }
  }

  private openSlot(slotId: string): RelaySlotSocket {
    const send = (payload: unknown): boolean => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) return false
      ws.send(JSON.stringify(payload))
      return true
    }
    const slot = new RelaySlotSocket(
      (envelope) => send({ ...envelope, mobileDeviceId: slotId }),
      (code, reason) => {
        if (this.slots.get(slotId) === slot) this.slots.delete(slotId)
        send({ type: 'kicked', mobileDeviceId: slotId, code, reason })
      },
    )
    this.slots.set(slotId, slot)
    slot.markOpen()
    this.opts.onSocket(slot.asNodeSocket())
    return slot
  }
}
