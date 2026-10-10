import type { LinkHostInfo } from './phone-link'
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
  | { type: 'handshake'; hostName?: string; host?: LinkHostInfo }
  | { type: 'peer_connected' }
  | { type: 'peer_disconnected' }
  | { type: 'kicked'; mobileDeviceId?: string }

export type FrameEffect =
  | { kind: 'drop' }
  | { kind: 'events'; events: unknown[] }
  | { kind: 'terminal'; payload: unknown }
  | { kind: 'desktop_shutdown' }
  | { kind: 'control'; frame: RelayControlFrame }
  | { kind: 'response'; requestId: string; payload: unknown }
  | { kind: 'response_error'; requestId: string; error: unknown }
  | { kind: 'response_chunk'; requestId: string; index: number; total: number; data: string }
  | { kind: 'pong' }

/** Opens a sealed link frame of the expected kind (and request) and decodes its host payload. */
export interface FrameDecrypt {
  (data: string, kind: 'event' | 'response' | 'terminal', requestId?: string): unknown
}

function asEvents(decrypted: unknown): unknown[] {
  if (Array.isArray(decrypted)) return decrypted
  if (decrypted && typeof decrypted === 'object') return [decrypted]
  return []
}

/**
 * Envelope `seq` is ignored: the secure channel orders and deduplicates every
 * sealed frame (a replayed or reordered one fails to open), and nothing is
 * replayed across connections, so there is no envelope ACK either.
 */
export function handleInboundFrame(frame: InboundFrame, decrypt: FrameDecrypt): FrameEffect {
  const type = frame.type
  if (type === 'pong') return { kind: 'pong' }
  if (type === 'desktop_shutdown') return { kind: 'desktop_shutdown' }
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
      return { kind: 'terminal', payload: decrypt(frame.data, 'terminal') }
    } catch {
      return { kind: 'drop' }
    }
  }
  if (type === 'response') {
    if (!frame.requestId || typeof frame.data !== 'string') return { kind: 'drop' }
    try {
      return { kind: 'response', requestId: frame.requestId, payload: decrypt(frame.data, 'response', frame.requestId) }
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
  if (type !== 'event' || typeof frame.data !== 'string') return { kind: 'drop' }
  try {
    return { kind: 'events', events: asEvents(decrypt(frame.data, 'event')) }
  } catch {
    return { kind: 'drop' }
  }
}
