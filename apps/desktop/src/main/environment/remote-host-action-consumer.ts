/**
 * Persistent Host Action consumer — one loop per live remote connectionId.
 *
 * Multiplexes every session bound to that connection's clientSessionId.
 * Lifecycle stays alive when the chat view is closed and after
 * sendSessionMessage's event drain returns — deliberately NOT per-session
 * or per-turn.
 *
 * Execution uses a bounded concurrent scheduler (min concurrency 2) so the
 * poll loop never awaits tool execution (keyed actions exist to parallelize).
 *
 * Replayed poll notifications are harmless: execution only begins after an
 * atomic claim. On reconnect, request an outstanding snapshot rather than
 * trusting a stale in-memory cursor.
 *
 * A claimed action outlives the socket it was claimed on. Claim and respond are
 * resent on the next connection with the same idempotency key, so a lost reply
 * replays the node's receipt instead of running the tool twice, and the claim
 * is renewed while the tool runs so a slow tool does not lapse into
 * `claim_expired`.
 */

import type {
  ClaimHostActionResult,
  HostActionPublicView,
  HostActionsPollResult,
  RespondHostActionResult,
} from '@superone/shared/environment'
import { DEFAULT_HOST_ACTION_CLAIM_TTL_MS } from '@superone/runtime/session/host-action-store'
import type { NodeRpcClient } from './node-rpc-client'

/** Renew well inside the claim TTL, so one slow round trip does not lose it. */
const CLAIM_RENEW_INTERVAL_MS = Math.floor(DEFAULT_HOST_ACTION_CLAIM_TTL_MS / 3)
/** How often a call waiting for the connection checks whether it is back. */
const RECONNECT_WAIT_MS = 200

/**
 * Injectable executor — product tools land later; tests supply a stub.
 * `connectionId` is the owning remote connection (per-consumer), so session-scoped
 * tools can route to the node instead of local SessionManager.
 */
export type HostActionExecutor = (
  claimed: ClaimHostActionResult,
  signal: AbortSignal,
  connectionId: string,
) => Promise<{
  outcome: 'succeeded' | 'failed'
  result?: unknown
  error?: unknown
  /**
   * Runs once the node accepted this response, never when the action was
   * cancelled or the response failed: what must not take effect before the
   * session has the result (a mailbox read) commits here.
   */
  onResponded?: () => void
}>

export interface RemoteHostActionConsumerOptions {
  connectionId: string
  client: NodeRpcClient
  executor: HostActionExecutor
  /** Bounded concurrency for in-flight executions. Default / minimum: 2. */
  concurrency?: number
  /** Long-poll wait when following the change log (ms). */
  pollWaitMs?: number
  /** How often a running action's claim is renewed (ms). */
  claimRenewIntervalMs?: number
  /** Called when the loop stops for logging/tests. */
  onStopped?: (reason: string) => void
  onError?: (err: unknown) => void
}

class BoundedScheduler {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly concurrency: number) {}

  get running(): number {
    return this.active
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.active++
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.active--
            const next = this.queue.shift()
            if (next) next()
          })
      }
      if (this.active < this.concurrency) run()
      else this.queue.push(run)
    })
  }
}

/**
 * One consumer per live remote connection. Start after handshake; stop on
 * disconnect / forget / app shutdown; restart on reconnect.
 */
export class RemoteHostActionConsumer {
  private readonly connectionId: string
  private readonly client: NodeRpcClient
  private readonly executor: HostActionExecutor
  private readonly scheduler: BoundedScheduler
  private readonly pollWaitMs: number
  private readonly claimRenewIntervalMs: number
  private readonly onStopped?: (reason: string) => void
  private readonly onError?: (err: unknown) => void

  private running = false
  private loopPromise: Promise<void> | null = null
  private stopReason: string | null = null
  /** In-flight claim AbortControllers keyed by actionId. */
  private readonly inflight = new Map<string, AbortController>()
  /** Track actionIds currently scheduled/claimed to avoid double-schedule from snapshot. */
  private readonly known = new Set<string>()
  /** Queued or running here. A transport loss must not forget these, or the snapshot would run them twice. */
  private readonly active = new Set<string>()

  constructor(opts: RemoteHostActionConsumerOptions) {
    this.connectionId = opts.connectionId
    this.client = opts.client
    this.executor = opts.executor
    const concurrency = Math.max(2, opts.concurrency ?? 2)
    this.scheduler = new BoundedScheduler(concurrency)
    this.pollWaitMs = opts.pollWaitMs ?? 10_000
    this.claimRenewIntervalMs = opts.claimRenewIntervalMs ?? CLAIM_RENEW_INTERVAL_MS
    this.onStopped = opts.onStopped
    this.onError = opts.onError
  }

  get isRunning(): boolean {
    return this.running
  }

  get connection(): string {
    return this.connectionId
  }

  /** True when this loop is already attached to the live RPC client. */
  isBoundTo(client: NodeRpcClient): boolean {
    return this.client === client
  }

  /** Start the poll loop (idempotent). Always begins with an outstanding snapshot. */
  start(): void {
    if (this.running) return
    this.running = true
    this.stopReason = null
    this.loopPromise = this.loop().finally(() => {
      this.running = false
      this.loopPromise = null
      if (this.stopReason) this.onStopped?.(this.stopReason)
    })
  }

  /** Stop the loop and abort in-flight executions. */
  stop(reason = 'stopped'): void {
    if (!this.running && !this.loopPromise) return
    this.stopReason = reason
    this.running = false
    for (const [, ac] of this.inflight) ac.abort()
    this.inflight.clear()
    this.known.clear()
    this.active.clear()
  }

  async waitUntilStopped(): Promise<void> {
    if (this.loopPromise) await this.loopPromise.catch(() => {})
  }

  private async loop(): Promise<void> {
    let cursor: string | null = null
    try {
      while (this.running) {
        if (!this.client.connected) {
          // Wait briefly for reconnect; EnvironmentHost restarts consumer on full reconnect.
          await sleep(200)
          if (!this.running) break
          continue
        }

        try {
          const poll = await this.poll(cursor)
          if (!this.running) break

          if (cursor === null) {
            // Outstanding snapshot path.
            for (const action of poll.outstanding ?? []) {
              this.scheduleIfNeeded(action)
            }
            cursor = poll.cursor
          } else {
            for (const change of poll.changes) {
              if (change.state === 'pending') {
                this.scheduleIfNeeded({
                  actionId: change.actionId,
                  sessionId: change.sessionId,
                  state: change.state,
                  version: change.version,
                  replayPolicy: change.replayPolicy,
                  deadline: 0,
                  createdAt: change.changedAt,
                })
              } else if (
                change.state === 'cancelled' ||
                change.state === 'succeeded' ||
                change.state === 'failed'
              ) {
                // Terminal: abort local work if still running and drop known.
                // Requeue (pending again) arrives as a separate change and can re-schedule.
                const ac = this.inflight.get(change.actionId)
                if (ac) ac.abort()
                this.inflight.delete(change.actionId)
                this.known.delete(change.actionId)
              }
              cursor = change.sequence
            }
            if (poll.changes.length === 0 && poll.cursor) {
              cursor = poll.cursor
            }
          }
        } catch (err) {
          this.onError?.(err)
          // Transport blip — back off and retry; reconnect path requests snapshot again.
          if (!this.running) break
          const msg = (err as Error)?.message ?? ''
          if (msg.includes('timeout') || msg.includes('closed') || msg.includes('transport')) {
            // Force snapshot on next successful poll after transport loss.
            // Actions still queued or running here keep their entry: they
            // resend over the next connection themselves.
            cursor = null
            for (const id of this.known) if (!this.active.has(id)) this.known.delete(id)
          }
          await sleep(500)
        }
      }
    } finally {
      for (const [, ac] of this.inflight) ac.abort()
      this.inflight.clear()
    }
  }

  private async poll(cursor: string | null): Promise<HostActionsPollResult> {
    if (cursor === null) {
      return this.client.rpc<HostActionsPollResult>('session.hostActionsPoll', {
        waitMs: 0,
        limit: 200,
      })
    }
    return this.client.rpc<HostActionsPollResult>('session.hostActionsPoll', {
      afterSequence: cursor,
      waitMs: this.pollWaitMs,
      limit: 200,
    })
  }

  private scheduleIfNeeded(action: HostActionPublicView): void {
    if (action.state !== 'pending') return
    if (this.known.has(action.actionId)) return
    this.known.add(action.actionId)
    this.active.add(action.actionId)

    void this.scheduler.schedule(async () => {
      if (!this.running) {
        this.known.delete(action.actionId)
        this.active.delete(action.actionId)
        return
      }
      const ac = new AbortController()
      this.inflight.set(action.actionId, ac)
      let stopRenewing = () => {}
      try {
        let claimed: ClaimHostActionResult
        try {
          // One key per claimed version: a resend after a lost reply replays the
          // same claim token instead of failing on a row that is already claimed.
          const claim = await this.rpcAcrossReconnects<ClaimHostActionResult>(
            'session.claimHostAction',
            { actionId: action.actionId, expectedVersion: action.version },
            `host-action-claim:${action.actionId}:${action.version}`,
            ac.signal,
          )
          claimed = claim.result
          // A replayed claim can be older than the action's end: it may have
          // been cancelled while the connection was down. Confirm before running.
          if (claim.resent) await this.rpcAcrossReconnects('session.renewHostActionClaim', renewPayload(claimed), undefined, ac.signal)
        } catch (err) {
          // Version conflict / deadline / forbidden — do not silent-drop; surface and allow re-poll.
          this.onError?.(err)
          this.known.delete(action.actionId)
          return
        }
        if (ac.signal.aborted) return

        stopRenewing = this.renewWhileRunning(claimed, ac)
        let outcome: Awaited<ReturnType<HostActionExecutor>>
        try {
          outcome = await this.executor(claimed, ac.signal, this.connectionId)
        } catch (err) {
          if (ac.signal.aborted) return
          outcome = {
            outcome: 'failed',
            error: { message: (err as Error)?.message ?? 'executor_error' },
          }
        }
        stopRenewing()
        if (ac.signal.aborted) return

        await this.rpcAcrossReconnects<RespondHostActionResult>(
          'session.respondHostAction',
          {
            actionId: claimed.actionId,
            claimToken: claimed.claimToken,
            outcome: outcome.outcome,
            result: outcome.result,
            error: outcome.error,
          },
          `host-action-respond:${claimed.actionId}:${claimed.version}`,
          ac.signal,
        )
        outcome.onResponded?.()
      } catch (err) {
        // Claim race (another socket won) or cancel — drop known so requeue can retry.
        const code = (err as { code?: string })?.code
        if (code === 'conflict' || code === 'failed_precondition' || code === 'forbidden') {
          this.known.delete(action.actionId)
        }
        this.onError?.(err)
      } finally {
        stopRenewing()
        this.inflight.delete(action.actionId)
        this.active.delete(action.actionId)
      }
    })
  }

  /**
   * Keep the claim alive while the tool runs. A renewal lost to the transport,
   * or one that raced another renewal, is retried on the next tick. One the
   * node refuses means the action ended there (cancelled, expired): the run is
   * aborted, since a terminal change missed while disconnected never arrives.
   */
  private renewWhileRunning(claimed: ClaimHostActionResult, run: AbortController): () => void {
    let stopped = false
    const timer = setInterval(() => {
      if (stopped || run.signal.aborted || !this.running || !this.client.connected) return
      this.client.rpc('session.renewHostActionClaim', renewPayload(claimed)).catch((err: unknown) => {
        if (stopped || isResendable(err) || (err as { code?: unknown })?.code === 'conflict') return
        stop()
        this.onError?.(err)
        run.abort()
      })
    }, this.claimRenewIntervalMs)
    timer.unref?.()
    const stop = () => {
      stopped = true
      clearInterval(timer)
    }
    return stop
  }

  /**
   * Send a claim or a response until the node answers it. A transport loss or a
   * reply that never came leaves the outcome unknown, so the call waits for the
   * connection and resends with the same key; the node replays its receipt if
   * the first one landed. Gives up when the action ends here or the loop stops.
   */
  private async rpcAcrossReconnects<T>(
    method: string,
    payload: unknown,
    commandKey: string | undefined,
    signal: AbortSignal,
  ): Promise<{ result: T; resent: boolean }> {
    let resent = false
    for (;;) {
      if (!this.running || signal.aborted) throw stoppedError(method)
      if (!this.client.connected) {
        await sleep(RECONNECT_WAIT_MS)
        continue
      }
      try {
        return { result: await this.client.rpc<T>(method, payload, undefined, commandKey), resent }
      } catch (err) {
        if (!isResendable(err)) throw err
        this.onError?.(err)
        resent = true
        await sleep(RECONNECT_WAIT_MS)
      }
    }
  }
}

function renewPayload(claimed: ClaimHostActionResult): { actionId: string; claimToken: string } {
  return { actionId: claimed.actionId, claimToken: claimed.claimToken }
}

/** The node may or may not have applied the call: a lost transport, or a local deadline. */
function isResendable(err: unknown): boolean {
  const e = err as { transport?: unknown; code?: unknown; rpcError?: unknown } | null
  if (e?.transport === true) return true
  return e?.code === 'deadline_exceeded' && e.rpcError !== true
}

function stoppedError(method: string): Error {
  return Object.assign(new Error(`${method} abandoned: host action ended or consumer stopped`), { code: 'aborted' })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
