/**
 * Application-level keepalive for a relay WebSocket. Both peers of the relay
 * (desktop and mobile) send the literal text `ping`; the relay's Durable Object
 * answers `pong` through `setWebSocketAutoResponse` without waking, and records
 * the time it did so — which is what its `/status` presence probe reads.
 *
 * A half-open TCP connection (Wi‑Fi switch, NAT idle drop, VPN toggle) never
 * delivers a close frame to either end, so without this a dead socket looks
 * OPEN forever: the desktop never re-dials and the relay keeps reporting it
 * online. The constants must stay in step with `HEARTBEAT_STALE_MS` in the
 * relay's `relay-session.ts`.
 */
export const RELAY_HEARTBEAT_INTERVAL_MS = 30_000
/** A `pong` comes straight from the relay edge; anything slower is a dead link. */
export const RELAY_HEARTBEAT_TIMEOUT_MS = 10_000
export const RELAY_PING = 'ping'
export const RELAY_PONG = 'pong'

export type RelayHeartbeat = {
  start(): void
  stop(): void
  /** Returns true when `raw` was the relay's pong and has been consumed. */
  onMessage(raw: string): boolean
}

export function createRelayHeartbeat(opts: {
  send: (text: string) => void
  /** The link is dead: the caller should close its socket so reconnection runs. */
  onTimeout: () => void
  intervalMs?: number
  timeoutMs?: number
}): RelayHeartbeat {
  const intervalMs = opts.intervalMs ?? RELAY_HEARTBEAT_INTERVAL_MS
  const timeoutMs = opts.timeoutMs ?? RELAY_HEARTBEAT_TIMEOUT_MS
  let interval: ReturnType<typeof setInterval> | null = null
  let pongTimer: ReturnType<typeof setTimeout> | null = null

  const clearPongTimer = (): void => {
    if (pongTimer != null) clearTimeout(pongTimer)
    pongTimer = null
  }
  const stop = (): void => {
    if (interval != null) clearInterval(interval)
    interval = null
    clearPongTimer()
  }
  const ping = (): void => {
    if (pongTimer != null) return
    try {
      opts.send(RELAY_PING)
    } catch {
      // A socket that rejects send is already closing; its close event takes over.
      return
    }
    pongTimer = setTimeout(() => {
      stop()
      opts.onTimeout()
    }, timeoutMs)
  }

  return {
    start() {
      stop()
      interval = setInterval(ping, intervalMs)
    },
    stop,
    onMessage(raw) {
      if (raw !== RELAY_PONG) return false
      clearPongTimer()
      return true
    },
  }
}
