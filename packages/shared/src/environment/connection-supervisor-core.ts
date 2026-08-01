/**
 * Platform-neutral connection supervisor (design §10).
 * Electron Main and future mobile clients wrap this with socket adapters.
 * This module must never import Electron.
 */

export type SupervisorState =
  | 'available'
  | 'connecting'
  | 'synchronizing'
  | 'connected'
  | 'disconnected'
  | 'backoff'
  | 'blocked'

export type BlockReason =
  | 'auth'
  | 'protocol_incompatible'
  | 'revoked'
  | 'invalid_config'
  | 'identity_conflict'
  | 'user'

export interface SupervisorSnapshot {
  environmentId: string
  connectionId: string
  state: SupervisorState
  attempt: number
  lastError?: string
  blockReason?: BlockReason
  nextRetryAt?: number
  generation: number
}

export interface SupervisorCoreOptions {
  environmentId: string
  connectionId: string
  connect: () => Promise<void>
  healthProbe?: () => Promise<boolean>
  baseDelayMs?: number
  maxDelayMs?: number
  now?: () => number
  random?: () => number
  onStateChange?: (snapshot: SupervisorSnapshot) => void
}

export class ConnectionSupervisorCore {
  private state: SupervisorState = 'available'
  private attempt = 0
  private lastError?: string
  private blockReason?: BlockReason
  private nextRetryAt?: number
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly now: () => number
  private readonly random: () => number

  constructor(private readonly opts: SupervisorCoreOptions) {
    this.baseDelayMs = opts.baseDelayMs ?? 500
    this.maxDelayMs = opts.maxDelayMs ?? 30_000
    this.now = opts.now ?? (() => Date.now())
    this.random = opts.random ?? Math.random
  }

  getSnapshot(): SupervisorSnapshot {
    return {
      environmentId: this.opts.environmentId,
      connectionId: this.opts.connectionId,
      state: this.state,
      attempt: this.attempt,
      lastError: this.lastError,
      blockReason: this.blockReason,
      nextRetryAt: this.nextRetryAt,
      generation: this.generation,
    }
  }

  async start(): Promise<void> {
    if (this.disposed || this.state === 'blocked') return
    if (this.state === 'connecting' || this.state === 'synchronizing' || this.state === 'connected') return
    await this.runConnect()
  }

  async probeOrRetry(): Promise<void> {
    if (this.disposed || this.state === 'blocked') return
    this.clearTimer()
    if (this.state === 'connected') {
      if (!this.opts.healthProbe) {
        // Already connected and no probe configured — do not force a reconnect.
        return
      }
      try {
        const ok = await this.opts.healthProbe()
        if (!ok) {
          this.transition('disconnected', 'health probe failed')
          await this.scheduleBackoff()
        }
        return
      } catch (err) {
        this.transition('disconnected', (err as Error).message)
        await this.scheduleBackoff()
        return
      }
    }
    this.attempt = 0
    await this.runConnect()
  }

  notifyDisconnected(error?: string): void {
    if (this.disposed || this.state === 'blocked') return
    this.transition('disconnected', error)
    void this.scheduleBackoff()
  }

  block(reason: BlockReason, error?: string): void {
    this.clearTimer()
    this.blockReason = reason
    this.transition('blocked', error)
  }

  unblock(): void {
    if (this.state !== 'blocked') return
    this.blockReason = undefined
    this.attempt = 0
    this.transition('available')
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
  }

  private async runConnect(): Promise<void> {
    this.generation += 1
    const gen = this.generation
    this.transition('connecting')
    try {
      this.transition('synchronizing')
      await this.opts.connect()
      if (this.disposed || gen !== this.generation) return
      this.attempt = 0
      this.nextRetryAt = undefined
      this.transition('connected')
    } catch (err) {
      if (this.disposed || gen !== this.generation) return
      const message = (err as Error).message || 'connect failed'
      const code = (err as { code?: string }).code
      if (code === 'unauthorized' || code === 'revoked') {
        this.block('auth', message)
        return
      }
      if (code === 'protocol_incompatible') {
        this.block('protocol_incompatible', message)
        return
      }
      if (code === 'identity_conflict') {
        this.block('identity_conflict', message)
        return
      }
      this.transition('disconnected', message)
      await this.scheduleBackoff()
    }
  }

  private async scheduleBackoff(): Promise<void> {
    if (this.disposed || this.state === 'blocked') return
    this.attempt += 1
    const exp = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.min(this.attempt - 1, 6))
    const jitter = exp * (0.5 + this.random() * 0.5)
    this.nextRetryAt = this.now() + jitter
    this.transition('backoff')
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.runConnect()
    }, jitter)
  }

  private transition(state: SupervisorState, error?: string): void {
    this.state = state
    if (error !== undefined) this.lastError = error
    if (state === 'connected') this.lastError = undefined
    this.opts.onStateChange?.(this.getSnapshot())
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
