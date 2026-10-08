import type { EndpointProfile } from './known-environment'

/**
 * Pairing code a desktop node shows (text or QR) and another desktop pastes.
 *
 * Format: `superone-node:<version>:<base64url JSON>`. The JSON carries the
 * node's environment id, the ways to reach it (a LAN hint, an optional
 * Tailscale address, and its relay room), the single-use pairing token, the
 * encrypted-channel credential and the token expiry. The channel secret travels
 * only inside this code, never over the network, so the code must not be logged.
 */

export const NODE_PAIRING_CODE_PREFIX = 'superone-node:'
export const NODE_PAIRING_CODE_VERSION = 2

export interface NodePairingCode {
  environmentId: string
  /** Where the node listens on its LAN: machine name (`Studio.local`) or address, and port. */
  lan?: { host: string; port: number }
  /** The node's Tailscale address, reached on the LAN port. */
  tailscaleHost?: string
  /** Relay broker URL (`wss://…`) and the node's relay room; neither is secret. */
  relay?: { url: string; room: string }
  pairingToken: string
  channel: { keyId: string; secretHex: string }
  /** Token expiry, epoch milliseconds. */
  expiresAt: number
}

export type NodePairingCodeErrorCode = 'invalid' | 'unsupported_version' | 'expired'

export class NodePairingCodeError extends Error {
  constructor(readonly code: NodePairingCodeErrorCode, message: string) {
    super(message)
    this.name = 'NodePairingCodeError'
  }
}

interface WirePayload {
  n: string
  l?: { h: string; p: number; ts?: string }
  r?: { u: string; m: string }
  t: string
  k: string
  s: string
  e: number
}

const SECRET_HEX = /^[0-9a-f]{64}$/i
const ROOM_ID = /^[0-9a-f]{32}$/

export function encodeNodePairingCode(code: NodePairingCode): string {
  const payload: WirePayload = {
    n: code.environmentId,
    ...(code.lan
      ? { l: { h: code.lan.host, p: code.lan.port, ...(code.tailscaleHost ? { ts: code.tailscaleHost } : {}) } }
      : {}),
    ...(code.relay ? { r: { u: code.relay.url, m: code.relay.room } } : {}),
    t: code.pairingToken,
    k: code.channel.keyId,
    s: code.channel.secretHex,
    e: code.expiresAt,
  }
  return `${NODE_PAIRING_CODE_PREFIX}${NODE_PAIRING_CODE_VERSION}:${toBase64Url(JSON.stringify(payload))}`
}

/**
 * Parse a pasted or scanned code. Whitespace (line wraps from copy/paste) is
 * ignored. Throws {@link NodePairingCodeError}; `expired` only when `now` is given.
 * Version 1 codes (a single URL) predate the release and are not accepted.
 */
export function decodeNodePairingCode(input: string, now?: number): NodePairingCode {
  const raw = input.replace(/\s+/g, '')
  if (!raw.startsWith(NODE_PAIRING_CODE_PREFIX)) throw invalid('missing prefix')
  const rest = raw.slice(NODE_PAIRING_CODE_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) throw invalid('missing version')
  const version = Number(rest.slice(0, sep))
  if (!Number.isInteger(version) || version < 1) throw invalid('bad version')
  if (version !== NODE_PAIRING_CODE_VERSION) {
    throw new NodePairingCodeError('unsupported_version', `pairing code version ${version} is not supported`)
  }

  let payload: Partial<WirePayload>
  try {
    payload = JSON.parse(fromBase64Url(rest.slice(sep + 1))) as Partial<WirePayload>
  } catch {
    throw invalid('unreadable payload')
  }
  if (!payload || typeof payload !== 'object') throw invalid('unreadable payload')
  const { n, l, r, t, k, s, e } = payload
  if (typeof n !== 'string' || !n) throw invalid('missing environment id')
  const lan = l === undefined ? undefined : readLan(l)
  const relay = r === undefined ? undefined : readRelay(r)
  if (!lan && !relay) throw invalid('no way to reach the node')
  if (typeof t !== 'string' || !t) throw invalid('missing token')
  if (typeof k !== 'string' || !k) throw invalid('missing channel key id')
  if (typeof s !== 'string' || !SECRET_HEX.test(s)) throw invalid('bad channel secret')
  if (typeof e !== 'number' || !Number.isFinite(e)) throw invalid('missing expiry')
  if (now !== undefined && e <= now) throw new NodePairingCodeError('expired', 'pairing code expired')
  return {
    environmentId: n,
    ...(lan ? { lan: { host: lan.h, port: lan.p } } : {}),
    ...(lan?.ts ? { tailscaleHost: lan.ts } : {}),
    ...(relay ? { relay: { url: relay.u.replace(/\/+$/, ''), room: relay.m } } : {}),
    pairingToken: t,
    channel: { keyId: k, secretHex: s },
    expiresAt: e,
  }
}

/** Endpoint ids the profiles from a pairing code use. */
export const NODE_LAN_ENDPOINT_ID = 'lan'
export const NODE_TAILSCALE_ENDPOINT_ID = 'tailscale'
export const NODE_RELAY_ENDPOINT_ID = 'relay'

/**
 * The endpoint profiles a paired desktop keeps for the node, in the order it
 * tries them: LAN, then Tailscale, then the relay.
 */
export function nodePairingEndpointProfiles(code: NodePairingCode): EndpointProfile[] {
  const profiles: EndpointProfile[] = []
  if (code.lan) {
    const target = `http://${hostForUrl(code.lan.host)}:${code.lan.port}`
    profiles.push({ endpointId: NODE_LAN_ENDPOINT_ID, kind: 'direct-wss', label: code.lan.host, target })
    if (code.tailscaleHost) {
      profiles.push({
        endpointId: NODE_TAILSCALE_ENDPOINT_ID,
        kind: 'tailscale',
        label: `Tailscale ${code.tailscaleHost}`,
        target: `http://${hostForUrl(code.tailscaleHost)}:${code.lan.port}`,
      })
    }
  }
  if (code.relay) {
    profiles.push({
      endpointId: NODE_RELAY_ENDPOINT_ID,
      kind: 'relay',
      label: 'Relay',
      target: code.relay.url,
      relay: { roomId: code.relay.room },
    })
  }
  return profiles
}

/** `Studio.local` → `Studio`: the node's LAN host is its machine name. */
export function nodePairingCodeLabel(code: NodePairingCode): string {
  return code.lan ? code.lan.host.replace(/\.local$/i, '') : code.environmentId.slice(0, 8)
}

function hostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

function readLan(value: unknown): { h: string; p: number; ts?: string } {
  const l = value as Record<string, unknown> | null
  if (!l || typeof l.h !== 'string' || !/^[A-Za-z0-9.:_[\]-]+$/.test(l.h)) throw invalid('bad lan host')
  if (typeof l.p !== 'number' || !Number.isInteger(l.p) || l.p < 1 || l.p > 65535) throw invalid('bad lan port')
  if (l.ts !== undefined && (typeof l.ts !== 'string' || !/^[0-9a-fA-F.:]+$/.test(l.ts))) throw invalid('bad tailscale host')
  return { h: l.h, p: l.p, ...(typeof l.ts === 'string' ? { ts: l.ts } : {}) }
}

function readRelay(value: unknown): { u: string; m: string } {
  const r = value as Record<string, unknown> | null
  if (!r || typeof r.u !== 'string' || !isWsUrl(r.u)) throw invalid('bad relay url')
  if (typeof r.m !== 'string' || !ROOM_ID.test(r.m)) throw invalid('bad relay room')
  return { u: r.u, m: r.m }
}

function invalid(detail: string): NodePairingCodeError {
  return new NodePairingCodeError('invalid', `invalid pairing code: ${detail}`)
}

function isWsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'ws:' || url.protocol === 'wss:') && !!url.hostname
  } catch {
    return false
  }
}

function toBase64Url(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('not base64url')
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}
