export type ConnectionState = 'reconnecting' | 'connected'

export type ReconnectControllerHooks = {
  onState: (state: ConnectionState, epoch: number) => void
  onRetry?: (error: unknown, delayMs: number) => void
}

export const RECONNECT_DELAYS_MS = [1_200, 2_400, 4_800, 8_000, 10_000] as const

/**
 * Owns one reconnect loop. A transport open is not "connected" until the
 * active session has rehydrated and released its buffered events.
 */
export class ReconnectController {
  private generation = 0
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private active = false

  constructor(
    private readonly reconnect: () => Promise<void>,
    private readonly restore: () => Promise<number>,
    private readonly hooks: ReconnectControllerHooks,
  ) {}

  get isActive(): boolean {
    return this.active
  }

  start(epoch: number): void {
    if (this.active) return
    this.active = true
    this.attempt = 0
    const generation = ++this.generation
    this.hooks.onState('reconnecting', epoch)
    this.schedule(generation)
  }

  cancel(): void {
    this.active = false
    this.generation += 1
    if (this.timer != null) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(generation: number): void {
    if (!this.active || generation !== this.generation) return
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)]
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run(generation)
    }, delay)
  }

  private async run(generation: number): Promise<void> {
    try {
      await this.reconnect()
      const epoch = await this.restore()
      if (!this.active || generation !== this.generation) return
      this.active = false
      this.hooks.onState('connected', epoch)
    } catch (error) {
      if (!this.active || generation !== this.generation) return
      this.attempt += 1
      const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)]
      this.hooks.onRetry?.(error, delay)
      this.schedule(generation)
    }
  }
}
