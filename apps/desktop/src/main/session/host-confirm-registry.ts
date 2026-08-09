/**
 * Shared bookkeeping for a human-in-the-loop `permission_request` raised from inside a tool
 * executor (config_apply, media_generate_video, miniapp_call, computer-use grants).
 *
 * Why this is a shared primitive rather than four hand-rolled Maps: the renderer keeps the prompt
 * in `pendingPermissions` until it sees an `interaction_resolved` carrying the same requestId
 * (`event-reducer/permission.ts`). So *every* terminal path — user answer, external cancel,
 * timeout — has to emit one, or the tool call ends while a dead dialog stays on screen. Each
 * copy of the pattern had its own timeout branch that settled the promise and forgot the event.
 *
 * Here settling is only reachable through `take()`, which clears the timer, drops the entry and
 * emits the event as one step, so a new terminal path cannot forget.
 */

import type { AgentEvent, PermissionRequest } from '@superone/shared/agent-types'

/** Anything that can push a host AgentEvent — the real `Session`, or a test double. */
export interface HostConfirmEmitter {
  emitHostEvent?(event: AgentEvent): void
}

interface PendingEntry<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  emitter: HostConfirmEmitter
  /** Detach the abort listener — a settled prompt must stop reacting to its turn ending. */
  unlisten?: () => void
}

export interface HostConfirmRegistryOptions {
  /** requestId namespace, e.g. `configconfirm` — descriptive only; routing is by map lookup. */
  idPrefix: string
  timeoutMs: number
  timeoutError: (requestId: string) => Error
}

export interface HostConfirmOpenOptions {
  /** Overrides the registry default when this prompt can name its subject in the error. */
  timeoutError?: (requestId: string) => Error
  /** Tears the prompt down when the turn that raised it goes away. */
  signal?: AbortSignal
  /** Required alongside `signal` — the error the parked caller is rejected with. */
  abortError?: () => Error
}

export class HostConfirmRegistry<T> {
  private readonly pending = new Map<string, PendingEntry<T>>()

  constructor(private readonly options: HostConfirmRegistryOptions) {}

  /**
   * Emit the prompt and park the caller until someone settles it. `buildRequest` receives the
   * generated requestId so call sites can log/trace it and embed it in their payload.
   */
  open(
    emitter: HostConfirmEmitter,
    buildRequest: (requestId: string) => PermissionRequest,
    options: HostConfirmOpenOptions = {},
  ): Promise<T> {
    const abortError = options.abortError ?? (() => new Error('Request cancelled'))
    // Already gone — never paint a prompt the user would have to dismiss by hand.
    if (options.signal?.aborted) return Promise.reject(abortError())

    const requestId = `${this.options.idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(requestId, (options.timeoutError ?? this.options.timeoutError)(requestId))
      }, this.options.timeoutMs)

      const entry: PendingEntry<T> = { resolve, reject, timer, emitter }
      if (options.signal) {
        const signal = options.signal
        const onAbort = () => this.fail(requestId, abortError())
        signal.addEventListener('abort', onAbort, { once: true })
        entry.unlisten = () => signal.removeEventListener('abort', onAbort)
      }

      this.pending.set(requestId, entry)
      emitter.emitHostEvent?.({ type: 'permission_request', request: buildRequest(requestId) })
    })
  }

  /** Resolve the parked caller with an outcome. Returns false when the id is unknown/already settled. */
  settle(requestId: string, approved: boolean, value: T): boolean {
    const entry = this.take(requestId, approved)
    if (!entry) return false
    entry.resolve(value)
    return true
  }

  /** Reject the parked caller. Returns false when the id is unknown/already settled. */
  fail(requestId: string, error: Error): boolean {
    const entry = this.take(requestId, false)
    if (!entry) return false
    entry.reject(error)
    return true
  }

  /** Test helper — drop parked entries without settling their waiters (avoids unhandled rejections). */
  clearForTests(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.unlisten?.()
    }
    this.pending.clear()
  }

  /** The single terminal exit: stop the timer, drop the entry, tell the UI the prompt is over. */
  private take(requestId: string, approved: boolean): PendingEntry<T> | undefined {
    const entry = this.pending.get(requestId)
    if (!entry) return undefined
    clearTimeout(entry.timer)
    entry.unlisten?.()
    this.pending.delete(requestId)
    entry.emitter.emitHostEvent?.({
      type: 'interaction_resolved',
      interactionType: 'permission',
      requestId,
      approved,
    })
    return entry
  }
}
