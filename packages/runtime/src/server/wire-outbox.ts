/**
 * Outgoing frames of one connection. Control (RPC replies, pongs) goes before
 * stream frames, a frame at a time, so a reply never waits behind a backlog of
 * events; the socket's own buffer is kept under {@link WireOutboxOptions.highWaterBytes}.
 * A stream source reads `congested()` and holds its events while the link is
 * slow (`openEventStream` flow control).
 */

export type WireLane = 'control' | 'stream'

export interface WireOutboxOptions {
  write(frame: string | Uint8Array): void
  /** Bytes the socket accepted but has not sent yet. */
  buffered(): number
  highWaterBytes?: number
  /** How often to retry while the socket is above the mark. */
  retryMs?: number
}

const DEFAULT_HIGH_WATER_BYTES = 1024 * 1024
const DEFAULT_RETRY_MS = 15

export class WireOutbox {
  private readonly lanes: Record<WireLane, Array<string | Uint8Array>> = { control: [], stream: [] }
  private queuedBytes = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly drainListeners = new Set<() => void>()
  private closed = false
  private readonly highWater: number

  constructor(private readonly opts: WireOutboxOptions) {
    this.highWater = opts.highWaterBytes ?? DEFAULT_HIGH_WATER_BYTES
  }

  send(frames: ReadonlyArray<string | Uint8Array>, lane: WireLane): void {
    if (this.closed) return
    for (const frame of frames) {
      this.lanes[lane].push(frame)
      this.queuedBytes += frame.length
    }
    this.pump()
  }

  /** The link is behind: frames are waiting, or the socket holds more than the mark. */
  congested(): boolean {
    return this.queuedBytes > 0 || this.opts.buffered() > this.highWater
  }

  /** Called once the outbox has emptied and the socket is under the mark again. */
  onDrain(listener: () => void): () => void {
    this.drainListeners.add(listener)
    return () => this.drainListeners.delete(listener)
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.lanes.control.length = 0
    this.lanes.stream.length = 0
    this.queuedBytes = 0
    this.drainListeners.clear()
  }

  private pump(): void {
    if (this.timer || this.closed) return
    while (this.opts.buffered() <= this.highWater) {
      const frame = this.lanes.control.shift() ?? this.lanes.stream.shift()
      if (frame === undefined) break
      this.queuedBytes -= frame.length
      this.opts.write(frame)
      if (this.closed) return
    }
    if (this.congested()) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.pump()
      }, this.opts.retryMs ?? DEFAULT_RETRY_MS)
      this.timer.unref?.()
      return
    }
    for (const listener of [...this.drainListeners]) listener()
  }
}
