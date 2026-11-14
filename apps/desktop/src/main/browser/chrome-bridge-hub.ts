import {
  ChromeBridgeChunkAssembler,
  isChromeBridgeChunk,
  type ChromeBridgeEventMessage,
  type ChromeBridgeEventName,
  type ChromeBridgeEvents,
  type ChromeBridgeMethod,
  type ChromeBridgeMethods,
  type ChromeBridgeRequest,
  type ChromeBridgeResponse,
} from '@superone/shared/chrome-bridge-protocol'

type EventListener = (event: ChromeBridgeEventName, params: ChromeBridgeEvents[ChromeBridgeEventName]) => void

interface Pending {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * One authenticated Chrome native-host connection.
 * Messages are JSON strings. Chunk envelopes from the protocol are joined first.
 */
export class ChromeBridgeHub {
  private sendRaw: ((json: string) => void) | null = null
  private readonly pending = new Map<number, Pending>()
  private readonly events = new Set<EventListener>()
  private readonly assembler = new ChromeBridgeChunkAssembler()
  private nextId = 1
  connected = false

  attach(send: (json: string) => void): void {
    this.detach('replaced')
    this.sendRaw = send
    this.connected = true
  }

  detach(reason: string): void {
    this.connected = false
    this.sendRaw = null
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.cleanup()
      pending.reject(new Error(`Chrome bridge disconnected (${reason})`))
    }
    this.pending.clear()
  }

  receive(json: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(json) as unknown
    } catch {
      return
    }
    if (isChromeBridgeChunk(parsed)) {
      const joined = this.assembler.accept(parsed)
      if (!joined) return
      this.receive(joined)
      return
    }
    const message = parsed as Partial<ChromeBridgeResponse & ChromeBridgeEventMessage>
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      pending.cleanup()
      this.pending.delete(message.id)
      if (typeof message.error === 'string' && message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.result)
      return
    }
    if (typeof message.event === 'string') {
      const event = message.event as ChromeBridgeEventName
      const params = (message.params ?? {}) as ChromeBridgeEvents[ChromeBridgeEventName]
      for (const listener of this.events) listener(event, params)
    }
  }

  onEvent(listener: EventListener): () => void {
    this.events.add(listener)
    return () => this.events.delete(listener)
  }

  call<M extends ChromeBridgeMethod>(
    method: M,
    params: ChromeBridgeMethods[M]['params'],
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<ChromeBridgeMethods[M]['result']> {
    if (!this.sendRaw || !this.connected) {
      return Promise.reject(new Error('Chrome bridge is not connected. Open the SuperOne extension in Chrome.'))
    }
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const id = this.nextId++
    const request: ChromeBridgeRequest<M> = { id, method, params }
    return new Promise((resolve, reject) => {
      if (opts?.signal?.aborted) {
        reject(new Error('Chrome bridge call was cancelled'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        cleanup()
        reject(new Error(`Chrome bridge '${method}' timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      const onAbort = () => {
        clearTimeout(timer)
        this.pending.delete(id)
        cleanup()
        reject(new Error('Chrome bridge call was cancelled'))
      }
      const cleanup = () => opts?.signal?.removeEventListener('abort', onAbort)
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject, timer, cleanup })
      opts?.signal?.addEventListener('abort', onAbort, { once: true })
      this.sendRaw!(JSON.stringify(request))
    })
  }
}

export const chromeBridgeHub = new ChromeBridgeHub()
