import { bytesToHex, randomBytes } from '@noble/ciphers/utils.js'
import { decryptPayload, encryptPayload, hexToByteArray } from './crypto'

/**
 * A pairing room on the relay (`/pair?channel=…`): one `desktop` and one
 * `mobile` socket that the relay connects and forwards between. Everything
 * that matters travels sealed under the temporary key the desktop's QR
 * carries, so only the device that scanned it can read or answer.
 */

/** The relay closes a pairing room three minutes after a socket joins. */
export const PAIR_ROOM_TIMEOUT_MS = 3 * 60 * 1000

export interface PairRoomSocket {
  send(data: string): void
  close(): void
  onopen: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  onclose: ((ev?: unknown) => void) | null
  onerror: ((ev?: unknown) => void) | null
}

export type OpenPairRoomSocket = (url: string) => PairRoomSocket

export function pairRoomUrl(relayUrl: string, channelId: string, role: 'desktop' | 'mobile'): string {
  return `${relayUrl.replace(/\/$/, '')}/pair?channel=${encodeURIComponent(channelId)}&role=${role}`
}

/** A fresh room: a random channel id and temporary key for a QR. */
export function newPairRoomKeys(): { channelId: string; tempKeyHex: string } {
  return { channelId: bytesToHex(randomBytes(8)), tempKeyHex: bytesToHex(randomBytes(32)) }
}

/** Six digits from a CSPRNG, for the person to compare across two screens. */
export function generatePairCode(): string {
  const b = randomBytes(4)
  const value = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
  return String(100000 + (value % 900000))
}

export interface PairRoomFrame {
  type: string
  /** The sealed body, opened; undefined for a frame without one. */
  body: Record<string, unknown> | undefined
}

export interface PairRoom<T> {
  /** Send a frame, sealing `body` under the room key. */
  send(type: string, body?: Record<string, unknown>): void
  /** Settles once with the room's outcome; the socket is closed by then. */
  done: Promise<T>
  /** Give up: rejects `done` with `error` and closes the socket. */
  cancel(error?: Error): void
}

/**
 * Join a pairing room and drive it until `onFrame` settles it. Frames sent
 * before the socket opens wait for it. A frame whose body does not open under
 * the room key is dropped, so a stranger in the room cannot steer it.
 */
export function joinPairRoom<T>(opts: {
  relayUrl: string
  channelId: string
  tempKeyHex: string
  role: 'desktop' | 'mobile'
  openSocket: OpenPairRoomSocket
  timeoutMs?: number
  onOpen?: (room: PairRoom<T>) => void
  onFrame: (frame: PairRoomFrame, settle: (result: { ok: true; value: T } | { ok: false; error: unknown }) => void) => void
}): PairRoom<T> {
  const key = hexToByteArray(opts.tempKeyHex)
  const ws = opts.openSocket(pairRoomUrl(opts.relayUrl, opts.channelId, opts.role))
  let open = false
  const pending: string[] = []
  let settle!: (result: { ok: true; value: T } | { ok: false; error: unknown }) => void
  const done = new Promise<T>((resolve, reject) => {
    let settled = false
    settle = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (result.ok) resolve(result.value)
      else reject(result.error)
      ws.close()
    }
    const timer = setTimeout(
      () => settle({ ok: false, error: new Error('pairing timeout') }),
      opts.timeoutMs ?? PAIR_ROOM_TIMEOUT_MS,
    )
  })
  const room: PairRoom<T> = {
    send(type, body) {
      const frame = JSON.stringify(body ? { type, data: encryptPayload(key, body) } : { type })
      if (open) ws.send(frame)
      else pending.push(frame)
    },
    done,
    cancel(error = new Error('pairing cancelled')) {
      settle({ ok: false, error })
    },
  }
  ws.onerror = () => settle({ ok: false, error: new Error('pairing socket error') })
  ws.onclose = () => settle({ ok: false, error: new Error('pairing socket closed') })
  ws.onopen = () => {
    open = true
    for (const frame of pending.splice(0)) ws.send(frame)
    try {
      opts.onOpen?.(room)
    } catch (error) {
      settle({ ok: false, error })
    }
  }
  ws.onmessage = (ev) => {
    let raw: { type?: unknown; data?: unknown }
    try {
      raw = JSON.parse(String(ev.data)) as { type?: unknown; data?: unknown }
    } catch {
      return
    }
    if (typeof raw.type !== 'string') return
    let body: Record<string, unknown> | undefined
    if (typeof raw.data === 'string') {
      try {
        const opened = decryptPayload(key, raw.data)
        if (!opened || typeof opened !== 'object') return
        body = opened as Record<string, unknown>
      } catch {
        return
      }
    }
    try {
      opts.onFrame({ type: raw.type, body }, settle)
    } catch (error) {
      settle({ ok: false, error })
    }
  }
  // Swallow the rejection a caller that only cancels never awaits.
  done.catch(() => {})
  return room
}

