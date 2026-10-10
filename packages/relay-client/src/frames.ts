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
  | { kind: 'desktop_shutdown' }
  | { kind: 'control'; frame: RelayControlFrame }
  | { kind: 'pong' }

/** Relay controls only. Application traffic uses authenticated native protocol frames. */
export function handleInboundFrame(frame: InboundFrame): FrameEffect {
  const type = frame.type
  if (type === 'pong') return { kind: 'pong' }
  if (type === 'desktop_shutdown') return { kind: 'desktop_shutdown' }
  if (type === 'peer_connected' || type === 'peer_disconnected') return { kind: 'control', frame: { type } }
  if (type === 'kicked') return { kind: 'control', frame: { type, ...(frame.mobileDeviceId ? { mobileDeviceId: frame.mobileDeviceId } : {}) } }
  return { kind: 'drop' }
}
