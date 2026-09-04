import { SeqAckTracker } from './ack'
import { decryptPayload } from './crypto'

export type TransportKind = 'relay' | 'lan'

export type InboundFrame = {
  type?: string
  seq?: number
  data?: string
  requestId?: string
  index?: number
  total?: number
  hostName?: string
  mobileDeviceId?: string
}

export type RelayControlFrame =
  | { type: 'handshake'; hostName?: string }
  | { type: 'peer_connected' }
  | { type: 'peer_disconnected' }
  | { type: 'kicked'; mobileDeviceId?: string }

export type FrameEffect =
  | { kind: 'drop' }
  | { kind: 'ack'; seq: number; flush: boolean }
  | { kind: 'events'; events: unknown[]; ack: { seq: number; flush: boolean } }
  | { kind: 'terminal'; payload: unknown }
  | { kind: 'reset' }
  | { kind: 'desktop_shutdown' }
  | { kind: 'control'; frame: RelayControlFrame }
  | { kind: 'response'; requestId: string; payload: unknown }
  | { kind: 'response_error'; requestId: string; error: unknown }
  | { kind: 'response_chunk'; requestId: string; index: number; total: number; data: string }
  | { kind: 'pong' }

export interface FrameDecrypt {
  (data: string): unknown
}

function asEvents(decrypted: unknown): unknown[] {
  if (Array.isArray(decrypted)) return decrypted
  if (decrypted && typeof decrypted === 'object') return [decrypted]
  return []
}

/** Never copy envelope seq onto AgentEvent.seq. */
function stripEnvelopeSeq(events: unknown[]): unknown[] {
  return events.map((ev) => {
    if (!ev || typeof ev !== 'object') return ev
    return ev
  })
}

export function handleInboundFrame(
  frame: InboundFrame,
  tracker: SeqAckTracker,
  decrypt: FrameDecrypt,
): FrameEffect {
  const type = frame.type
  if (type === 'pong') return { kind: 'pong' }
  if (type === 'reset') {
    tracker.clear()
    return { kind: 'reset' }
  }
  if (type === 'desktop_shutdown') {
    tracker.clear()
    return { kind: 'desktop_shutdown' }
  }
  if (type === 'handshake') {
    return { kind: 'control', frame: { type, ...(frame.hostName ? { hostName: frame.hostName } : {}) } }
  }
  if (type === 'peer_connected' || type === 'peer_disconnected') {
    return { kind: 'control', frame: { type } }
  }
  if (type === 'kicked') {
    return {
      kind: 'control',
      frame: { type, ...(frame.mobileDeviceId ? { mobileDeviceId: frame.mobileDeviceId } : {}) },
    }
  }
  if (type === 'terminal') {
    if (typeof frame.data !== 'string') return { kind: 'drop' }
    try {
      return { kind: 'terminal', payload: decrypt(frame.data) }
    } catch {
      return { kind: 'drop' }
    }
  }
  if (type === 'response') {
    if (!frame.requestId || typeof frame.data !== 'string') return { kind: 'drop' }
    try {
      return { kind: 'response', requestId: frame.requestId, payload: decrypt(frame.data) }
    } catch (error) {
      return { kind: 'response_error', requestId: frame.requestId, error }
    }
  }
  if (type === 'response_chunk') {
    if (!frame.requestId || frame.index == null || frame.total == null || typeof frame.data !== 'string') {
      return { kind: 'drop' }
    }
    return {
      kind: 'response_chunk',
      requestId: frame.requestId,
      index: frame.index,
      total: frame.total,
      data: frame.data,
    }
  }
  if (type !== 'event') return { kind: 'drop' }

  const seq = frame.seq ?? 0
  if (!tracker.see(seq)) return { kind: 'drop' }

  const marked = tracker.markProcessed(seq)
  const ack = { seq: marked.lastAckedSeq, flush: marked.shouldAckNow }

  if (typeof frame.data !== 'string') return { kind: 'ack', seq: ack.seq, flush: ack.flush }

  let decrypted: unknown
  try {
    decrypted = decrypt(frame.data)
  } catch {
    return { kind: 'ack', seq: ack.seq, flush: ack.flush }
  }

  return {
    kind: 'events',
    events: stripEnvelopeSeq(asEvents(decrypted)),
    ack,
  }
}

export function makeDecrypt(aesKeyBytes: Uint8Array): FrameDecrypt {
  return (data: string) => decryptPayload(aesKeyBytes, data)
}
