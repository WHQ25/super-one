import { MAX_REMOTE_CIPHERTEXT_CHARS, REMOTE_LINK_HEADER_MAX_BYTES } from '@superone/shared/remote-payload'
import { base64 } from './crypto-backend'
import { SecureChannelError, type SecureChannel } from './secure-channel'

/**
 * Phone ↔ host link over LAN and the relay. Each phone holds its own pairing
 * credential; every connection runs the secure-channel handshake inside
 * `channel` envelopes, then every application frame is one sealed channel
 * frame, base64 in the envelope's `data`. The sealed body is
 * `headerLen:u16be || header JSON || payload`: the header binds the frame's
 * kind (and request id) so a relay cannot relabel an event as a response.
 * Host payloads are host application frames (flag + length + JSON/DEFLATE);
 * phone commands are raw JSON. Format: docs/architecture/relay-crypto.md.
 */

/** Envelope type carrying the handshake messages and the host's sealed `handshake` frame. */
export const LINK_CHANNEL_FRAME = 'channel'

/**
 * What a host says about itself once the channel is up. Sealed, so it is as
 * authentic as the pairing: `host` is its release, the protocol generation it
 * serves and its canonical environment id. Hosts before the unified protocol
 * omit `host`.
 */
export type LinkHandshakeInfo = {
  hostName: string
  lan?: { hosts: string[]; port: number }
  host?: LinkHostInfo
}

export type LinkHostInfo = { appVersion: string; protocol: number; environmentId: string }

export type LinkHeader =
  | ({ t: 'handshake' } & LinkHandshakeInfo)
  | { t: 'event' }
  | { t: 'response'; requestId: string }
  | { t: 'terminal' }
  | { t: 'command' }

export type LinkKind = LinkHeader['t']

const HEADER_LEN_BYTES = 2
const EMPTY = new Uint8Array(0)
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

/** `headerLen:u16be || header JSON || payload`, the plaintext body of one sealed link frame. */
export function encodeLinkBody(header: LinkHeader, payload: Uint8Array = EMPTY): Uint8Array {
  const headerBytes = encoder.encode(JSON.stringify(header))
  if (headerBytes.length > REMOTE_LINK_HEADER_MAX_BYTES) throw new Error('link header too large')
  const body = new Uint8Array(HEADER_LEN_BYTES + headerBytes.length + payload.length)
  new DataView(body.buffer).setUint16(0, headerBytes.length)
  body.set(headerBytes, HEADER_LEN_BYTES)
  body.set(payload, HEADER_LEN_BYTES + headerBytes.length)
  return body
}

export function decodeLinkBody(body: Uint8Array): { header: LinkHeader; payload: Uint8Array } {
  if (body.length < HEADER_LEN_BYTES) throw new SecureChannelError('channel_protocol', 'link frame too short')
  const headerLength = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint16(0)
  if (headerLength > REMOTE_LINK_HEADER_MAX_BYTES || HEADER_LEN_BYTES + headerLength > body.length) {
    throw new SecureChannelError('channel_protocol', 'invalid link header length')
  }
  let raw: unknown
  try {
    raw = JSON.parse(decoder.decode(body.subarray(HEADER_LEN_BYTES, HEADER_LEN_BYTES + headerLength)))
  } catch {
    throw new SecureChannelError('channel_protocol', 'link header is not JSON')
  }
  return { header: readHeader(raw), payload: body.subarray(HEADER_LEN_BYTES + headerLength) }
}

/** Seal one link frame; the result goes in an envelope's `data`. */
export function sealLinkFrame(channel: SecureChannel, header: LinkHeader, payload: Uint8Array = EMPTY): string {
  return base64().encode(channel.sealBytes(encodeLinkBody(header, payload)))
}

/** Open, replay-check and parse a link frame. Throws `SecureChannelError` on any failure. */
export function openLinkFrame(channel: SecureChannel, data: string): { header: LinkHeader; payload: Uint8Array } {
  if (data.length > MAX_REMOTE_CIPHERTEXT_CHARS) throw new SecureChannelError('channel_protocol', 'link frame exceeds limit')
  return decodeLinkBody(channel.openBytes(base64().decode(data)))
}

function readHeader(raw: unknown): LinkHeader {
  const h = raw as Record<string, unknown> | null
  switch (h?.t) {
    case 'event':
    case 'terminal':
    case 'command':
      return { t: h.t }
    case 'response':
      if (typeof h.requestId === 'string' && h.requestId) return { t: 'response', requestId: h.requestId }
      break
    case 'handshake':
      if (typeof h.hostName === 'string') {
        const lan = h.lan as { hosts?: unknown; port?: unknown } | undefined
        const validLan = lan && Array.isArray(lan.hosts) && lan.hosts.every((x) => typeof x === 'string')
          && typeof lan.port === 'number'
        const host = readHostInfo(h.host)
        return {
          t: 'handshake',
          hostName: h.hostName,
          ...(validLan ? { lan: { hosts: lan.hosts as string[], port: lan.port as number } } : {}),
          ...(host ? { host } : {}),
        }
      }
      break
  }
  throw new SecureChannelError('channel_protocol', 'invalid link header')
}

function readHostInfo(raw: unknown): LinkHostInfo | null {
  const host = raw as Record<string, unknown> | null | undefined
  if (!host || typeof host.appVersion !== 'string' || typeof host.environmentId !== 'string' || !Number.isInteger(host.protocol)) return null
  return { appVersion: host.appVersion, protocol: host.protocol as number, environmentId: host.environmentId }
}
