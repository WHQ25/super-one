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
  /** OS reports no network; auto-retry suspended until network-online. */
  | 'offline'

export type BlockReason =
  | 'auth'
  | 'protocol_incompatible'
  | 'revoked'
  | 'invalid_config'
  | 'identity_conflict'
  | 'user'

/** Lifecycle wake that probes or preempts backoff without unblocking auth failures. */
export type SupervisorWakeReason =
  | 'app-resume'
  | 'network-online'
  | 'network-offline'
  /** Self-scheduled liveness check while connected (see healthProbeIntervalMs). */
  | 'health-probe'

export type RetryNowDisposition = 'started' | 'already_connected' | 'blocked' | 'disposed'

/**
 * Whether an explicit user action (the Connect button) may clear a block and
 * re-dial with the stored credential.
 *
 * Recoverable: the blocking condition lives outside the credential and the user
 * can have fixed it since — an upgraded desktop clears `protocol_incompatible`,
 * edited endpoints clear `invalid_config`, and `user` is a self-imposed stop.
 *
 * Terminal: `auth` / `revoked` need a fresh pairing token (Repair pairing).
 * `identity_conflict` is a trust boundary — the node's fingerprint no longer
 * matches what was pinned. Existing re-pair refuses a changed fingerprint on
 * purpose (pin stays authoritative), so the real recovery is Forget + re-add
 * with a conscious trust decision — never a silent re-dial past the check.
 */
export function isUserRecoverableBlock(reason: BlockReason | undefined): boolean {
  return reason === 'protocol_incompatible' || reason === 'invalid_config' || reason === 'user'
}

/**
 * True when an auth error means the stored credential family is dead and must
 * be re-paired — not a transient refresh/proof flake that Connect should retry.
 *
 * Nodes historically emitted only `code: 'unauthorized'` for both classes; we
 * accept an explicit `revoked` code and also classify common terminal messages.
 */
export function isTerminalCredentialFailure(
  code: string | undefined,
  message: string,
): boolean {
  if (code === 'revoked') return true
  if (code !== 'unauthorized') return false
  return /session revoked|token reuse|refresh token expired|invalid refresh token|pairing token revoked|pairing token expired|pairing token already used/i.test(
    message,
  )
}

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
  /**
   * Drop a half-open transport before an immediate re-dial (e.g. OPEN but dead WS).
   * Called from wake() when a health probe fails while connected.
   */
  invalidateTransport?: (reason: string) => void | Promise<void>
  /** Continuous connected time before attempt/backoff ladder resets. Default 30s. */
  stableAfterMs?: number
  /**
   * Period for self-scheduled healthProbe while connected. Default 30s; 0 disables.
   * Resume/online edges alone leave a socket that dies on an awake, online
   * machine undetected until the user sends something.
   */
  healthProbeIntervalMs?: number
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
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private probeTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false
  private wakeInFlight: Promise<void> | null = null
  /** Latest wake reason while a wake is in flight (drained after current wake). */
  private pendingWake: SupervisorWakeReason | null = null
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly stableAfterMs: number
  private readonly healthProbeIntervalMs: number
  private readonly now: () => number
  private readonly random: () => number

  constructor(private readonly opts: SupervisorCoreOptions) {
    this.baseDelayMs = opts.baseDelayMs ?? 500
    this.maxDelayMs = opts.maxDelayMs ?? 30_000
    this.stableAfterMs = opts.stableAfterMs ?? 30_000
    this.healthProbeIntervalMs = opts.healthProbeIntervalMs ?? 30_000
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

  /**
   * App resume / network online. Coalesced. Never unblocks auth failures.
   * Connected: health probe; failure invalidates transport and re-dials immediately.
   * Backoff/disconnected: preempt timer and re-dial immediately without clearing
   * the failure streak (unlike retryNow).
   */
  async wake(reason: SupervisorWakeReason): Promise<void> {
    if (this.disposed || this.state === 'blocked') return
    // Always keep the latest reason; drain after the current wake completes so
    // offline→online (or reverse) edges are not dropped by single-flight.
    this.pendingWake = reason
    if (this.wakeInFlight) return this.wakeInFlight
    this.wakeInFlight = this.drainWake().finally(() => {
      this.wakeInFlight = null
    })
    return this.wakeInFlight
  }

  private async drainWake(): Promise<void> {
    while (this.pendingWake && !this.disposed) {
      const reason = this.pendingWake
      this.pendingWake = null
      await this.doWake(reason)
    }
  }

  /**
   * Explicit user/system retry: resets the transient backoff ladder.
   * Does not clear a blocked state unless `opts.unblock` is set — that flag
   * marks a direct user action (Connect), which may clear the blocks listed in
   * {@link isUserRecoverableBlock}. Auth and identity blocks stay terminal even
   * then; they are cleared only by a successful re-pair.
   */
  async retryNow(opts?: { unblock?: boolean }): Promise<RetryNowDisposition> {
    if (this.disposed) return 'disposed'
    if (this.state === 'blocked') {
      if (!opts?.unblock || !isUserRecoverableBlock(this.blockReason)) return 'blocked'
      this.unblock()
    }
    if (this.state === 'connected') return 'already_connected'
    if (this.state === 'connecting' || this.state === 'synchronizing') return 'started'
    this.attempt = 0
    this.nextRetryAt = undefined
    this.clearTimer()
    await this.runConnect()
    return 'started'
  }

  /**
   * @deprecated Prefer wake() for lifecycle and retryNow() for explicit reset.
   * Kept for call sites; connected path probes, else resets attempt and dials.
   */
  async probeOrRetry(): Promise<void> {
    if (this.disposed || this.state === 'blocked') return
    if (this.state === 'connected') {
      await this.wake('app-resume')
      return
    }
    await this.retryNow()
  }

  /**
   * Transport dropped while we believed we were connected. Only transitions from
   * `connected` so overlapping notify during backoff/connecting does not reset
   * attempt counters or schedule a second dial.
   */
  notifyDisconnected(error?: string): void {
    if (this.disposed || this.state === 'blocked') return
    if (this.state !== 'connected') return
    this.clearStableTimer()
    this.transition('disconnected', error)
    void this.scheduleBackoff()
  }

  block(reason: BlockReason, error?: string): void {
    this.clearTimer()
    this.clearStableTimer()
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
    this.clearStableTimer()
    this.stopHealthProbeTimer()
  }

  private async doWake(reason?: SupervisorWakeReason): Promise<void> {
    if (this.disposed || this.state === 'blocked') return

    if (reason === 'network-offline') {
      // `blocked` already returned above; only `available` still needs a guard.
      if (this.state === 'available') return
      // Bump generation so an in-flight runConnect cannot land on connected/backoff.
      this.generation += 1
      this.clearTimer()
      this.clearStableTimer()
      try {
        await this.opts.invalidateTransport?.('network offline')
      } catch {
        /* best-effort */
      }
      this.transition('offline', 'network offline')
      return
    }

    if (this.state === 'connected') {
      if (!this.opts.healthProbe) return
      let ok = false
      try {
        ok = await this.opts.healthProbe()
      } catch (err) {
        ok = false
        this.lastError = (err as Error).message
      }
      if (this.disposed || this.state !== 'connected') return
      if (ok) return

      const failReason = this.lastError || 'health probe failed'
      try {
        await this.opts.invalidateTransport?.(failReason)
      } catch {
        /* best-effort */
      }
      if (this.disposed) return
      this.clearStableTimer()
      if (this.state === 'connected') {
        this.transition('disconnected', failReason)
      }
      await this.runConnect()
      return
    }

    if (this.state === 'connecting' || this.state === 'synchronizing') return

    // Preempt backoff / leave offline and dial now without clearing the streak.
    this.clearTimer()
    this.nextRetryAt = undefined
    await this.runConnect()
  }

  private async runConnect(): Promise<void> {
    if (this.disposed || this.state === 'blocked') return
    // A live dial already owns the generation; do not start a second one.
    if (this.state === 'connecting' || this.state === 'synchronizing' || this.state === 'connected') return
    this.clearTimer()
    this.clearStableTimer()
    this.generation += 1
    const gen = this.generation
    this.transition('connecting')
    try {
      this.transition('synchronizing')
      await this.opts.connect()
      if (this.disposed || gen !== this.generation) return
      // Do not reset attempt here — short flaps must keep escalating backoff.
      this.nextRetryAt = undefined
      this.clearTimer()
      this.transition('connected')
      this.scheduleStableReset(gen)
    } catch (err) {
      if (this.disposed || gen !== this.generation) return
      // Offline supersedes failed dial — do not schedule backoff while offline.
      if (this.state === 'offline') return
      const message = (err as Error).message || 'connect failed'
      const code = (err as { code?: string }).code
      // Dead credential family → terminal block (Repair pairing). Prefer the
      // explicit `revoked` reason when the node/code says so; otherwise keep
      // `auth` for message-classified unauthorized so older UIs still match.
      if (isTerminalCredentialFailure(code, message)) {
        this.block(code === 'revoked' ? 'revoked' : 'auth', message)
        return
      }
      // Non-terminal unauthorized (proof window, etc.): back off and re-try the
      // *stored* credential instead of minting another client_sessions row.
      if (code === 'unauthorized') {
        this.transition('disconnected', message)
        await this.scheduleBackoff()
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

  private scheduleStableReset(gen: number): void {
    this.clearStableTimer()
    if (this.stableAfterMs <= 0) {
      this.attempt = 0
      return
    }
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null
      if (this.disposed || this.generation !== gen || this.state !== 'connected') return
      this.attempt = 0
    }, this.stableAfterMs)
  }

  private transition(state: SupervisorState, error?: string): void {
    this.state = state
    if (error !== undefined) this.lastError = error
    if (state === 'connected') {
      this.lastError = undefined
      this.startHealthProbeTimer()
    } else {
      this.stopHealthProbeTimer()
    }
    this.opts.onStateChange?.(this.getSnapshot())
  }

  /**
   * Self-scheduled liveness check. Routed through wake() so it shares the
   * single-flight guard and the connected-branch probe/invalidate/re-dial path.
   */
  private startHealthProbeTimer(): void {
    this.stopHealthProbeTimer()
    if (this.healthProbeIntervalMs <= 0 || !this.opts.healthProbe) return
    this.probeTimer = setInterval(() => {
      if (this.disposed || this.state !== 'connected') return
      void this.wake('health-probe').catch(() => {
        /* wake already records lastError */
      })
    }, this.healthProbeIntervalMs)
    // A keepalive must never hold the process open on its own.
    ;(this.probeTimer as { unref?: () => void }).unref?.()
  }

  private stopHealthProbeTimer(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer)
      this.probeTimer = null
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private clearStableTimer(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer)
      this.stableTimer = null
    }
  }
}
