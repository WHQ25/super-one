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
 */

import type {
  ClaimHostActionResult,
  HostActionPublicView,
  HostActionsPollResult,
  RespondHostActionResult,
} from '@superone/shared/environment'
import type { NodeRpcClient } from './node-rpc-client'

/** Injectable executor — product tools land later; tests supply a stub. */
export type HostActionExecutor = (
  claimed: ClaimHostActionResult,
  signal: AbortSignal,
) => Promise<{ outcome: 'succeeded' | 'failed'; result?: unknown; error?: unknown }>

export interface RemoteHostActionConsumerOptions {
  connectionId: string
  client: NodeRpcClient
  executor: HostActionExecutor
  /** Bounded concurrency for in-flight executions. Default / minimum: 2. */
  concurrency?: number
  /** Long-poll wait when following the change log (ms). */
  pollWaitMs?: number
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
  private readonly onStopped?: (reason: string) => void
  private readonly onError?: (err: unknown) => void

  private running = false
  private loopPromise: Promise<void> | null = null
  private stopReason: string | null = null
  /** In-flight claim AbortControllers keyed by actionId. */
  private readonly inflight = new Map<string, AbortController>()
  /** Track actionIds currently scheduled/claimed to avoid double-schedule from snapshot. */
  private readonly known = new Set<string>()

  constructor(opts: RemoteHostActionConsumerOptions) {
    this.connectionId = opts.connectionId
    this.client = opts.client
    this.executor = opts.executor
    const concurrency = Math.max(2, opts.concurrency ?? 2)
    this.scheduler = new BoundedScheduler(concurrency)
    this.pollWaitMs = opts.pollWaitMs ?? 10_000
    this.onStopped = opts.onStopped
    this.onError = opts.onError
  }

  get isRunning(): boolean {
    return this.running
  }

  get connection(): string {
    return this.connectionId
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
            cursor = null
            this.known.clear()
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

    void this.scheduler.schedule(async () => {
      if (!this.running) {
        this.known.delete(action.actionId)
        return
      }
      const ac = new AbortController()
      this.inflight.set(action.actionId, ac)
      try {
        const claimed = await this.client.rpc<ClaimHostActionResult>('session.claimHostAction', {
          actionId: action.actionId,
          expectedVersion: action.version,
        })
        if (ac.signal.aborted) return

        let outcome: { outcome: 'succeeded' | 'failed'; result?: unknown; error?: unknown }
        try {
          outcome = await this.executor(claimed, ac.signal)
        } catch (err) {
          if (ac.signal.aborted) return
          outcome = {
            outcome: 'failed',
            error: { message: (err as Error)?.message ?? 'executor_error' },
          }
        }
        if (ac.signal.aborted) return

        await this.client.rpc<RespondHostActionResult>('session.respondHostAction', {
          actionId: claimed.actionId,
          claimToken: claimed.claimToken,
          outcome: outcome.outcome,
          result: outcome.result,
          error: outcome.error,
        })
      } catch (err) {
        // Claim race (another socket won) or cancel — drop known so requeue can retry.
        const code = (err as { code?: string })?.code
        if (code === 'conflict' || code === 'failed_precondition' || code === 'forbidden') {
          this.known.delete(action.actionId)
        }
        this.onError?.(err)
      } finally {
        this.inflight.delete(action.actionId)
      }
    })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
