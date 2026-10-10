/**
 * The client half of one protocol connection, whatever socket carries it:
 * request envelopes, their receipts and errors, pushed stream frames and
 * detail packets. Metro-safe; each client keeps its own socket adapter
 * (dialing, the channel, heartbeats) and hands this the decoded messages.
 * A new socket is a new connection.
 */

import { RequestCoalescer, canonicalJson } from '../request-coalescer'
import type { DetailUpdate } from './detail'
import type { DraftStreamMessage, SessionDetailMessage, SessionStreamFrame, SessionStreamMessage, TerminalStreamMessage, TopicNoticeFrame, TopicNoticeMessage } from './events'
import type { RpcError } from './rpc'
import type { HandshakeGenerations } from './protocol'
import type { ControlLostEvent, ClientStreamMessage } from './events'
import { RpcInbox } from './rpc-inbox'

export interface RpcConnectionOptions {
  protocolVersion: number
  newId(): string
  /** The error a request rejects with for the server's `rpc_error`. */
  responseError(error: RpcError): Error
  /** The error a request rejects with when it outlives its deadline. */
  timeoutError(method: string): Error
  /** Reads that identical concurrent calls may share. */
  coalesces?(method: string): boolean
  onControlLost?(event: ControlLostEvent): void
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
  onTerminal?(event: TerminalStreamMessage['event']): void
  onDraft?(event: DraftStreamMessage['event']): void
  onTopic?(frame: TopicNoticeFrame): void
  /** The connection ended; the stream with it. */
  onEnd(err: Error): void
}

export class RpcConnection {
  private readonly inbox: RpcInbox
  private readonly streams = new Map<string, RpcStreamHandlers>()
  private readonly details = new Map<string, (update: DetailUpdate) => void>()
  private readonly reads = new RequestCoalescer()
  private ended: Error | null = null

  constructor(
    private readonly send: (message: unknown) => void,
    private readonly opts: RpcConnectionOptions,
  ) { this.inbox = new RpcInbox(() => opts.newId()) }

  /** Generation handshake shares the same registered-before-send receipt handling. */
  handshake(payload: HandshakeGenerations, timeoutMs = 10_000): Promise<{ protocol: number; databaseSchema: number; environmentId: string }> {
    if (this.ended) return Promise.reject(this.ended)
    return this.inbox.begin({ type: 'handshake', payload }, this.send, timeoutMs, {
      timeoutError: () => this.opts.timeoutError('handshake'),
    })
  }

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
    if (this.opts.onControlLost && msg.type === 'client' && (message as ClientStreamMessage).event?.type === 'control_lost') {
      this.opts.onControlLost((message as ClientStreamMessage).event as ControlLostEvent)
      return true
    }
    if (!msg || typeof msg !== 'object') return false
    if (msg.type === 'stream') {
      const { subscriptionId, frame } = message as SessionStreamMessage
      this.streams.get(subscriptionId)?.onFrame(frame)
      return true
    }
    if (msg.type === 'terminal') {
      const { subscriptionId, event } = message as TerminalStreamMessage
      this.streams.get(subscriptionId)?.onTerminal?.(event)
      return true
    }
    if (msg.type === 'draft') {
      const { subscriptionId, event } = message as DraftStreamMessage
      this.streams.get(subscriptionId)?.onDraft?.(event)
      return true
    }
    if (msg.type === 'topic') {
      const { subscriptionId, frame } = message as TopicNoticeMessage
      this.streams.get(subscriptionId)?.onTopic?.(frame)
      return true
    }
    if (msg.type === 'detail') {
      const { update } = message as SessionDetailMessage
      this.details.get(update.subscriptionId)?.(update)
      return true
    }
    if ((msg.type !== 'rpc_result' && msg.type !== 'rpc_error' && msg.type !== 'handshake_ok') || !msg.requestId) return false
    if (!this.inbox.has(msg.requestId)) return true
    if (msg.type === 'rpc_error') {
      this.inbox.fail(msg.requestId, this.opts.responseError({ code: msg.error?.code ?? 'internal', message: msg.error?.message ?? 'rpc error', details: msg.error?.details }))
    } else {
      this.inbox.complete(msg.requestId, msg.result)
    }
    return true
  }

  /** The connection is gone: pending requests reject and streams end with `err`. */
  close(err: Error): void {
    if (this.ended) return
    this.ended = err
    this.inbox.failAll(err)
    const streams = [...this.streams.values()]
    this.streams.clear()
    this.details.clear()
    this.reads.clear()
    for (const stream of streams) stream.onEnd(err)
  }

  private dispatch<T>(method: string, payload: unknown, options: RpcRequestOptions): Promise<T> {
    if (this.ended) return Promise.reject(this.ended)
    return this.inbox.begin<T>({
      type: 'rpc',
      method,
      payload,
      environmentId: options.environmentId,
      protocolVersion: this.opts.protocolVersion,
      idempotencyKey: options.idempotencyKey,
    }, (message) => {
      try { this.send(message) }
      catch (err) { throw err instanceof Error ? err : new Error(String(err)) }
    }, options.timeoutMs ?? null, {
      timeoutError: () => this.opts.timeoutError(method),
      onTimeout: options.onTimeout,
    })
  }
}
