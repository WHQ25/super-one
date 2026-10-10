import type {
  ClaimHostActionResult,
  HostActionChange,
  HostActionPublicView,
  HostActionReplayPolicy,
  HostActionsPollResult,
  HostActionTerminalResult,
  RespondHostActionResult,
} from '@superone/shared/environment'
import {
  DEFAULT_HOST_ACTION_CLAIM_TTL_MS,
  DEFAULT_HOST_ACTION_DEADLINE_MS,
  type HostActionRow,
  type HostActionStore,
} from './host-action-store'

/** What the channel needs to know about a session to admit, claim or cancel its actions. */
export interface HostActionSessionView {
  controllerClientSessionId: string | null
  hostActionCapabilityVersion: number
  hostActionToolGroups: readonly string[]
  /** Closed or ended: no new actions, no claims. */
  closed: boolean
  /** A turn is running; host tools only make sense mid-turn. */
  streaming: boolean
}

export interface HostActionChannelDeps {
  store: HostActionStore
  session(sessionId: string): HostActionSessionView | null
  /** The session's in-flight turn signal; an action dies with its turn. */
  turnSignal?(sessionId: string): AbortSignal | undefined
  /** Observability hook after an action is created (never sees args). */
  onRequested?(sessionId: string, actionId: string): void
  /** True while the host shuts down: new actions are refused. */
  isDisposing?(): boolean
}

interface HostActionWaiter {
  settle: (result: HostActionTerminalResult) => void
  timer: ReturnType<typeof setTimeout> | null
}

function coded(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

/**
 * Controller-scoped Host Action channel: a session asks its controller (the
 * paired desktop) to run a tool and waits for the terminal result; the
 * controller long-polls, claims and responds. Durable state lives in the
 * {@link HostActionStore}; this class owns live waiters, long-poll wakeups and
 * claim/deadline reconciliation. Any host that serves `session.*` (the node
 * runtime, a desktop) plugs in its sessions through {@link HostActionSessionView}.
 */
export class HostActionChannel {
  private readonly store: HostActionStore
  /** Live waiters for requestHostAction terminal settlement. */
  private readonly waiters = new Map<string, HostActionWaiter>()
  /** Long-poll waiters woken on host action change. */
  private readonly pollWaiters = new Set<() => void>()
  private expiryTimer: ReturnType<typeof setInterval> | null = null
  /** Set by {@link shutdown}; new actions are refused. */
  private shutDown = false
  private readonly unsubscribe: () => void

  constructor(private readonly deps: HostActionChannelDeps) {
    this.store = deps.store
    this.unsubscribe = this.store.subscribe(() => this.wakePollers())
    // Periodic claim/deadline reconciliation (claim TTL requeue / cancel).
    this.expiryTimer = setInterval(() => this.reconcileExpiry(), 2_000)
    // Don't keep the process alive solely for this timer (tests + node).
    this.expiryTimer.unref?.()
  }

  /** Cancel every non-terminal action left by a previous process so crash-window waiters settle. */
  reconcileAfterRestart(): void {
    for (const row of this.store.reconcileAfterRestart()) this.settle(this.store.toTerminal(row))
  }

  /**
   * Create a host action and await its terminal state.
   * Cancelled by interrupt / turn end / session close / deadline / restart.
   * Late responses after cancellation are rejected by the store.
   */
  request(input: {
    sessionId: string
    turnId?: string | null
    toolName: string
    toolGroup: string
    args: unknown
    replayPolicy?: HostActionReplayPolicy
    deadlineMs?: number
    /**
     * When aborted, cancel this action (MCP tool handler should pass the turn signal).
     * Also auto-bound to the session's in-flight turn AbortSignal when present.
     */
    signal?: AbortSignal
  }): Promise<HostActionTerminalResult> {
    if (this.shutDown || this.deps.isDisposing?.()) {
      return Promise.reject(coded('runtime is shutting down', 'failed_precondition'))
    }
    const session = this.deps.session(input.sessionId)
    if (!session) return Promise.reject(coded('session not found', 'not_found'))
    if (!session.controllerClientSessionId) {
      return Promise.reject(coded('session has no controller binding', 'failed_precondition'))
    }
    if (session.hostActionCapabilityVersion < 1) {
      return Promise.reject(coded('hostActionV1 not granted on this session', 'failed_precondition'))
    }
    if (!session.hostActionToolGroups.includes(input.toolGroup)) {
      return Promise.reject(coded(`tool group not granted: ${input.toolGroup}`, 'forbidden'))
    }
    if (session.closed) return Promise.reject(coded('session is closed', 'failed_precondition'))

    const deadlineMs = input.deadlineMs ?? DEFAULT_HOST_ACTION_DEADLINE_MS
    const row = this.store.create({
      sessionId: input.sessionId,
      turnId: input.turnId ?? null,
      controllerClientSessionId: session.controllerClientSessionId,
      toolName: input.toolName,
      toolGroup: input.toolGroup,
      args: input.args,
      replayPolicy: input.replayPolicy ?? 'safe',
      deadlineMs,
    })
    this.deps.onRequested?.(input.sessionId, row.actionId)

    return new Promise<HostActionTerminalResult>((resolve) => {
      const remaining = Math.max(0, row.deadline - Date.now())
      const timer = setTimeout(() => {
        this.cancelAction(row.actionId, 'deadline_exceeded')
      }, remaining + 50)

      const abortCleanups: Array<() => void> = []
      const onAbort = (reason: string) => {
        this.cancelAction(row.actionId, reason)
      }

      // Bind to explicit signal + active turn abort (interrupt / turn end).
      const signals: AbortSignal[] = []
      if (input.signal) signals.push(input.signal)
      const turnAbort = this.deps.turnSignal?.(input.sessionId)
      if (turnAbort && turnAbort !== input.signal) signals.push(turnAbort)

      for (const sig of signals) {
        if (sig.aborted) {
          // Defer so the waiter is registered before settle.
          queueMicrotask(() => onAbort('aborted'))
          break
        }
        const handler = () => onAbort('aborted')
        sig.addEventListener('abort', handler, { once: true })
        abortCleanups.push(() => sig.removeEventListener('abort', handler))
      }

      this.waiters.set(row.actionId, {
        settle: (result) => {
          clearTimeout(timer)
          for (const c of abortCleanups) c()
          this.waiters.delete(row.actionId)
          resolve(result)
        },
        timer,
      })
    })
  }

  /**
   * Controller-scoped long-poll. Without afterSequence: outstanding snapshot + cursor.
   * With afterSequence: durable state changes after the cursor (waits up to waitMs).
   * Exposes IDs, state, version, replayPolicy — never args.
   */
  async poll(input: {
    controllerClientSessionId: string
    afterSequence?: string | null
    waitMs?: number
    limit?: number
  }): Promise<HostActionsPollResult> {
    // Opportunistic expiry pass before answering.
    this.reconcileExpiry()

    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
    const waitMs = Math.min(Math.max(input.waitMs ?? 0, 0), 30_000)
    const hasCursor = input.afterSequence != null && input.afterSequence !== ''

    if (!hasCursor) {
      const outstanding = this.store.listOutstanding(input.controllerClientSessionId)
      return { outstanding, changes: [], cursor: this.store.headSequence() }
    }

    const after = String(input.afterSequence)
    const existing = this.store.listChangesAfter(input.controllerClientSessionId, after, limit)
    if (existing.length > 0 || waitMs === 0) {
      return {
        changes: existing,
        cursor: existing.length ? existing[existing.length - 1]!.sequence : this.store.headSequence(),
      }
    }

    // Long-poll: wait for a change or timeout.
    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        this.pollWaiters.delete(done)
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(done, waitMs)
      this.pollWaiters.add(done)
    })

    const changes = this.store.listChangesAfter(input.controllerClientSessionId, after, limit)
    return {
      changes,
      cursor: changes.length ? changes[changes.length - 1]!.sequence : this.store.headSequence(),
    }
  }

  /**
   * Atomically claim a pending action for the authenticated controller.
   * Verifies binding, capability/grant, active turn, and pending state.
   */
  claim(input: {
    actionId: string
    expectedVersion: number
    controllerClientSessionId: string
    claimTtlMs?: number
  }): ClaimHostActionResult {
    this.reconcileExpiry()

    const existing = this.store.get(input.actionId)
    if (!existing) throw coded('host action not found', 'not_found')
    if (existing.controllerClientSessionId !== input.controllerClientSessionId) {
      throw coded('not the session controller', 'forbidden')
    }

    const session = this.deps.session(existing.sessionId)
    if (!session) throw coded('session not found', 'not_found')
    if (session.controllerClientSessionId !== input.controllerClientSessionId) {
      throw coded('not the session controller', 'forbidden')
    }
    if (session.hostActionCapabilityVersion < 1) throw coded('hostActionV1 not granted', 'failed_precondition')
    if (!session.hostActionToolGroups.includes(existing.toolGroup)) {
      throw coded(`tool group not granted: ${existing.toolGroup}`, 'forbidden')
    }
    if (session.closed) throw coded('session is closed', 'failed_precondition')
    // Active turn required — host tools only make sense mid-turn.
    if (!session.streaming) throw coded('no active turn', 'failed_precondition')

    const { row, claimToken } = this.store.claim({
      actionId: input.actionId,
      expectedVersion: input.expectedVersion,
      controllerClientSessionId: input.controllerClientSessionId,
      claimTtlMs: input.claimTtlMs ?? DEFAULT_HOST_ACTION_CLAIM_TTL_MS,
    })

    return {
      actionId: row.actionId,
      version: row.version,
      claimToken,
      claimExpiresAt: row.claimExpiresAt!,
      toolName: row.toolName,
      toolGroup: row.toolGroup,
      args: JSON.parse(row.argsJson),
      replayPolicy: row.replayPolicy,
      sessionId: row.sessionId,
      turnId: row.turnId,
    }
  }

  /**
   * Extend a live claim instead of letting it lapse — the desktop asks when a
   * Host Action's outputs are still uploading. Bounded by the action's own
   * deadline, so the agent never waits longer than it already agreed to.
   */
  renew(input: {
    actionId: string
    claimToken: string
    controllerClientSessionId: string
    ttlMs?: number
  }): { actionId: string; version: number; claimExpiresAt: number } {
    const row = this.store.renewClaim({
      actionId: input.actionId,
      claimToken: input.claimToken,
      controllerClientSessionId: input.controllerClientSessionId,
      ttlMs: input.ttlMs ?? DEFAULT_HOST_ACTION_CLAIM_TTL_MS,
    })
    return { actionId: row.actionId, version: row.version, claimExpiresAt: row.claimExpiresAt! }
  }

  /**
   * Atomically verify claim token, persist terminal result, settle live waiter.
   * Identical response returns stored receipt; different payload → conflict.
   */
  respond(input: {
    actionId: string
    claimToken: string
    controllerClientSessionId: string
    outcome: 'succeeded' | 'failed'
    result?: unknown
    error?: unknown
  }): RespondHostActionResult {
    const { row, duplicate } = this.store.respond({
      actionId: input.actionId,
      claimToken: input.claimToken,
      controllerClientSessionId: input.controllerClientSessionId,
      outcome: input.outcome,
      result: input.result,
      error: input.error,
    })
    // A duplicate identical response still settles any waiter left behind.
    this.settle(this.store.toTerminal(row))
    return {
      actionId: row.actionId,
      state: row.state as 'succeeded' | 'failed',
      version: row.version,
      duplicate,
    }
  }

  listOutstanding(controllerClientSessionId: string): HostActionPublicView[] {
    return this.store.listOutstanding(controllerClientSessionId)
  }

  listChanges(controllerClientSessionId: string, afterSequence: string, limit = 100): HostActionChange[] {
    return this.store.listChangesAfter(controllerClientSessionId, afterSequence, limit)
  }

  /** Re-address a session's actions to its new controller; claims of the old one are cancelled. */
  rebind(sessionId: string, toControllerClientSessionId: string): void {
    const { cancelled } = this.store.rebindSessionController({ sessionId, toControllerClientSessionId })
    for (const row of cancelled) this.settle(this.store.toTerminal(row))
    this.wakePollers()
  }

  cancelForSession(sessionId: string, reason: string): void {
    this.cancel(() => this.store.cancel({ sessionId, reason }))
  }

  cancelAction(actionId: string, reason: string): void {
    this.cancel(() => this.store.cancel({ actionId, reason }))
  }

  /**
   * The host stops serving: refuse new actions, cancel every action a live
   * waiter is blocked on (while the store is still open) and settle each
   * waiter, so no tool call outlives the host. Then {@link dispose}.
   */
  shutdown(reason: string): void {
    this.shutDown = true
    this.cancelWaiting(reason)
    this.dispose()
  }

  /** Cancel and settle every action a live waiter is blocked on; new actions are still taken. */
  cancelWaiting(reason: string): void {
    for (const actionId of [...this.waiters.keys()]) this.cancelAction(actionId, reason)
    // A row the store could no longer cancel still owes its caller an answer.
    for (const actionId of [...this.waiters.keys()]) {
      this.settle({ actionId, state: 'cancelled', error: { code: reason } })
    }
  }

  /** Stop the reconciliation timer and release long-pollers. Pending actions stay for the caller to cancel. */
  dispose(): void {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer)
      this.expiryTimer = null
    }
    this.unsubscribe()
    this.wakePollers()
  }

  private cancel(run: () => HostActionRow[]): void {
    try {
      for (const row of run()) this.settle(this.store.toTerminal(row))
    } catch (err) {
      // Shutdown races: db may already be closed when turn finally runs.
      if ((err as Error).message?.includes('not open')) return
      throw err
    }
  }

  private settle(result: HostActionTerminalResult): void {
    const waiter = this.waiters.get(result.actionId)
    if (!waiter) return
    if (waiter.timer) clearTimeout(waiter.timer)
    this.waiters.delete(result.actionId)
    waiter.settle(result)
  }

  private wakePollers(): void {
    for (const w of [...this.pollWaiters]) {
      try {
        w()
      } catch {
        /* ignore */
      }
    }
  }

  private reconcileExpiry(): void {
    try {
      for (const row of this.store.reconcileExpired()) {
        if (row.state === 'cancelled' || row.state === 'succeeded' || row.state === 'failed') {
          this.settle(this.store.toTerminal(row))
        }
      }
    } catch {
      /* ignore reconcile errors (db closed during dispose) */
    }
  }
}
