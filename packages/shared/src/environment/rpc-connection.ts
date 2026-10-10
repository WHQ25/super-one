/**
 * The client half of one protocol connection, whatever socket carries it:
 * request envelopes, their receipts and errors, pushed stream frames and
 * detail packets. Metro-safe; each client keeps its own socket adapter
 * (dialing, the channel, heartbeats) and hands this the decoded messages.
 * A new socket is a new connection.
 */

import { RequestCoalescer, canonicalJson } from '../request-coalescer'
import type { DetailUpdate } from './detail'
import type { SessionDetailMessage, SessionStreamFrame, SessionStreamMessage } from './events'
import type { RpcError } from './rpc'

export interface RpcConnectionOptions {
  protocolVersion: number
  newId(): string
  /** The error a request rejects with for the server's `rpc_error`. */
  responseError(error: RpcError): Error
  /** The error a request rejects with when it outlives its deadline. */
  timeoutError(method: string): Error
  /** Reads that identical concurrent calls may share. */
  coalesces?(method: string): boolean
}

export interface RpcRequestOptions {
  /** The environment the envelope addresses; the server checks it is its own. */
  environmentId: string
  /** Required by the server for mutating methods. */
  idempotencyKey?: string
  /** No deadline when omitted. */
  timeoutMs?: number
  /** Told when the deadline passes, after the request rejected. */
  onTimeout?(): void
}

export interface RpcStreamHandlers {
  onFrame(frame: SessionStreamFrame): void
  /** The connection ended; the stream with it. */
  onEnd(err: Error): void
}

interface Pending {
  resolve(value: unknown): void
  reject(err: Error): void
  timer: ReturnType<typeof setTimeout> | undefined
}

export class RpcConnection {
  private readonly pending = new Map<string, Pending>()
  private readonly streams = new Map<string, RpcStreamHandlers>()
  private readonly details = new Map<string, (update: DetailUpdate) => void>()
  private readonly reads = new RequestCoalescer()
  private ended: Error | null = null

  constructor(
    private readonly send: (message: unknown) => void,
    private readonly opts: RpcConnectionOptions,
  ) {}

  request<T>(method: string, payload: unknown, options: RpcRequestOptions): Promise<T> {
    const key = this.opts.coalesces?.(method) && !options.idempotencyKey
      ? JSON.stringify([method, options.environmentId, canonicalJson(payload), options.timeoutMs ?? null])
      : null
    return this.reads.run(key, () => this.dispatch<T>(method, payload, options))
  }

  /** Route pushed frames for `subscriptionId` until closed or the connection ends. */
  openStream(subscriptionId: string, handlers: RpcStreamHandlers): void {
    this.streams.set(subscriptionId, handlers)
  }

  /** False when the stream was already gone. */
  closeStream(subscriptionId: string): boolean {
    return this.streams.delete(subscriptionId)
  }

  hasStream(subscriptionId: string): boolean {
    return this.streams.has(subscriptionId)
  }

  /** Route detail packets for an expanded row until unwatched or the connection ends. */
  watchDetail(subscriptionId: string, listener: (update: DetailUpdate) => void): void {
    this.details.set(subscriptionId, listener)
  }

  /** False when the row was not being watched. */
  unwatchDetail(subscriptionId: string): boolean {
    return this.details.delete(subscriptionId)
  }

  /** Handles a decoded message from the server; false when it is not a reply or a push. */
  receive(message: unknown): boolean {
    const msg = message as { type?: string; requestId?: string; result?: unknown; error?: RpcError }
    if (!msg || typeof msg !== 'object') return false
    if (msg.type === 'stream') {
      const { subscriptionId, frame } = message as SessionStreamMessage
      this.streams.get(subscriptionId)?.onFrame(frame)
      return true
    }
    if (msg.type === 'detail') {
      const { update } = message as SessionDetailMessage
      this.details.get(update.subscriptionId)?.(update)
      return true
    }
    if ((msg.type !== 'rpc_result' && msg.type !== 'rpc_error') || !msg.requestId) return false
    const pending = this.pending.get(msg.requestId)
    if (!pending) return true
    this.pending.delete(msg.requestId)
    clearTimeout(pending.timer)
    if (msg.type === 'rpc_error') {
      pending.reject(this.opts.responseError({ code: msg.error?.code ?? 'internal', message: msg.error?.message ?? 'rpc error', details: msg.error?.details }))
    } else {
      pending.resolve(msg.result)
    }
    return true
  }

  /** The connection is gone: pending requests reject and streams end with `err`. */
  close(err: Error): void {
    if (this.ended) return
    this.ended = err
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
    const streams = [...this.streams.values()]
    this.streams.clear()
    this.details.clear()
    this.reads.clear()
    for (const stream of streams) stream.onEnd(err)
  }

  private dispatch<T>(method: string, payload: unknown, options: RpcRequestOptions): Promise<T> {
    if (this.ended) return Promise.reject(this.ended)
    const requestId = this.opts.newId()
    return new Promise<T>((resolve, reject) => {
      const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
        this.pending.delete(requestId)
        reject(this.opts.timeoutError(method))
        options.onTimeout?.()
      }, options.timeoutMs)
      this.pending.set(requestId, { resolve: (value) => resolve(value as T), reject, timer })
      try {
        this.send({
          type: 'rpc',
          requestId,
          method,
          payload,
          environmentId: options.environmentId,
          protocolVersion: this.opts.protocolVersion,
          idempotencyKey: options.idempotencyKey,
        })
      } catch (err) {
        this.pending.delete(requestId)
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }
}
