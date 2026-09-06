import { computeRoomId, deriveKeys } from './crypto'

/** The relay answers a status probe fast or not at all; a stalled request is offline. */
export const RELAY_STATUS_TIMEOUT_MS = 5_000
/** A desktop on the same network answers in single-digit milliseconds. */
export const LAN_PROBE_TIMEOUT_MS = 1_500

export type PresenceResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export type PresenceFetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<PresenceResponse>

const roomIds = new Map<string, string>()

/**
 * HKDF + SHA-256 over the pairing secret. Memoised: discovery re-derives this for
 * every saved device on every refresh, and the result never changes for a secret.
 */
export function roomIdForSecret(masterSecret: string): string {
  const cached = roomIds.get(masterSecret)
  if (cached !== undefined) return cached
  const room = computeRoomId(deriveKeys(masterSecret).channelKeyHex)
  roomIds.set(masterSecret, room)
  return room
}

/** `host:port` as stored on a pairing, or advertised over mDNS. */
export function parseLanHostPort(raw: string | null | undefined): { host: string; port: number } | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const separator = trimmed.lastIndexOf(':')
  if (separator <= 0) return null
  const host = trimmed.slice(0, separator).replace(/^\[|\]$/g, '')
  const port = Number(trimmed.slice(separator + 1))
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65_535) return null
  return { host, port }
}

function relayHttpBase(relayUrl: string): string {
  let url: URL
  try {
    url = new URL(relayUrl)
  } catch {
    throw new Error('presence: invalid relay URL')
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`presence: rejected ${url.protocol || 'unknown'} relay URL`)
  }
  return relayUrl.replace(/^ws/, 'http').replace(/\/$/, '')
}

function bracketed(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

const defaultFetch: PresenceFetch = (url, init) =>
  fetch(url, init) as unknown as Promise<PresenceResponse>

async function probe(
  url: string,
  fetcher: PresenceFetch | undefined,
  timeoutMs: number,
): Promise<PresenceResponse | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await (fetcher ?? defaultFetch)(url, { signal: controller.signal })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Ask the relay whether a desktop currently holds this pairing's room. Cheap
 * enough to run for every saved device in parallel on each refresh.
 */
export async function checkRelayDesktopOnline(opts: {
  relayUrl: string
  masterSecret: string
  fetch?: PresenceFetch
  now?: () => number
  timeoutMs?: number
}): Promise<boolean> {
  const base = relayHttpBase(opts.relayUrl)
  const room = roomIdForSecret(opts.masterSecret)
  const ts = String((opts.now ?? Date.now)())
  const res = await probe(
    `${base}/status?room=${room}&ts=${ts}`,
    opts.fetch,
    opts.timeoutMs ?? RELAY_STATUS_TIMEOUT_MS,
  )
  if (!res?.ok) return false
  try {
    return (await res.json() as { desktop?: unknown } | null)?.desktop === true
  } catch {
    return false
  }
}

/**
 * The desktop's LAN server answers every unrecognised GET with 426 Upgrade
 * Required, so any HTTP response at all proves it is listening — which is what
 * lets this work without a raw socket, something React Native cannot open.
 */
export async function checkLanReachable(opts: {
  host: string
  port: number
  fetch?: PresenceFetch
  timeoutMs?: number
}): Promise<boolean> {
  const res = await probe(
    `http://${bracketed(opts.host)}:${opts.port}/`,
    opts.fetch,
    opts.timeoutMs ?? LAN_PROBE_TIMEOUT_MS,
  )
  return res !== null
}
