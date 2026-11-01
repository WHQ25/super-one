import type { DeviceFrame, DeviceStreamOptions } from '@superone/shared/device'

/**
 * How many times a closed port may be asked for again before the panel is left
 * on the last frame. A port that cannot stay open would otherwise reopen on
 * every close. A frame that arrives clears the count.
 */
const REOPEN_LIMIT = 3
const REOPEN_DELAY_MS = 200

export interface DeviceFramePort {
  onmessage: ((event: { data: DeviceFrame }) => void) | null
  start(): void
  close(): void
  /**
   * The DOM port's `close` event. The `onclose` property is not in this
   * project's MessagePort types; the event is what Chromium fires when main
   * closes its end.
   */
  addEventListener(type: 'close', listener: () => void): void
  removeEventListener(type: 'close', listener: () => void): void
}

/**
 * The renderer's half of a device preview port.
 *
 * Main closes the port when a frame cannot be posted, and that used to be the
 * end of the subscription: the canvas kept its last bitmap and nobody here
 * asked for the stream again. An intentional `close` clears the want first, so
 * a detach does not reopen.
 */
export class DeviceStreamPorts {
  private readonly ports = new Map<string, DeviceFramePort>()
  private readonly options = new Map<string, DeviceStreamOptions | undefined>()
  private readonly attempts = new Map<string, number>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly closers = new Map<string, () => void>()

  constructor(
    private readonly sendOpen: (deviceId: string, options: DeviceStreamOptions | undefined) => void,
    private readonly sendClose: (deviceId: string) => void,
    private readonly listeners: Map<string, Set<(frame: DeviceFrame) => void>>,
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) => setTimeout(fn, ms),
    private readonly cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
  ) {}

  open(deviceId: string, options: DeviceStreamOptions | undefined): void {
    this.options.set(deviceId, options)
    this.attempts.delete(deviceId)
    this.sendOpen(deviceId, options)
  }

  close(deviceId: string): void {
    this.options.delete(deviceId)
    this.attempts.delete(deviceId)
    this.clearTimer(deviceId)
    this.drop(deviceId)
    this.sendClose(deviceId)
  }

  accept(deviceId: string, port: DeviceFramePort): void {
    this.drop(deviceId)
    this.ports.set(deviceId, port)
    port.onmessage = (message) => {
      this.attempts.delete(deviceId)
      const listeners = this.listeners.get(deviceId)
      if (listeners) for (const listener of listeners) listener(message.data)
    }
    const onClose = () => {
      if (this.ports.get(deviceId) !== port) return
      this.ports.delete(deviceId)
      this.closers.delete(deviceId)
      this.reopen(deviceId)
    }
    this.closers.set(deviceId, onClose)
    port.addEventListener('close', onClose)
    port.start()
  }

  private drop(deviceId: string): void {
    const port = this.ports.get(deviceId)
    const onClose = this.closers.get(deviceId)
    if (onClose) {
      port?.removeEventListener('close', onClose)
      this.closers.delete(deviceId)
    }
    if (!port) return
    this.ports.delete(deviceId)
    port.close()
  }

  private clearTimer(deviceId: string): void {
    const timer = this.timers.get(deviceId)
    if (!timer) return
    this.cancel(timer)
    this.timers.delete(deviceId)
  }

  private reopen(deviceId: string): void {
    if (!this.options.has(deviceId) || this.timers.has(deviceId)) return
    const attempt = (this.attempts.get(deviceId) ?? 0) + 1
    this.attempts.set(deviceId, attempt)
    if (attempt > REOPEN_LIMIT) return
    const timer = this.schedule(() => {
      this.timers.delete(deviceId)
      if (!this.options.has(deviceId) || this.ports.has(deviceId)) return
      this.sendOpen(deviceId, this.options.get(deviceId))
    }, REOPEN_DELAY_MS)
    this.timers.set(deviceId, timer)
  }
}
