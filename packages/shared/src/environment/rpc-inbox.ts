/** Metro-safe request receipts shared by every protocol client; the wire decoder owns fragmentation. */
export interface RpcInboxRequest {
  [key: string]: unknown
  requestId?: string
  type?: string
  method?: string
}

export interface RpcInboxDeadline {
  timeoutError?(): unknown
  onTimeout?(): void
}

export type PendingRpc = {
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
}

export class RpcInbox {
  private readonly pending = new Map<string, PendingRpc>()

  constructor(private readonly id: () => string = () => crypto.randomUUID()) {}

  has(requestId: string): boolean { return this.pending.has(requestId) }

  /** Register before sending; null keeps a request pending without a deadline. */
  begin<T = unknown>(command: RpcInboxRequest, send: (payload: Record<string, unknown>) => void, timeoutMs: number | null = 15_000, deadline: RpcInboxDeadline = {}): Promise<T> {
    const requestId = 'requestId' in command && typeof command.requestId === 'string' && command.requestId
      ? command.requestId
      : this.id()
    const payload = { ...command, requestId } as Record<string, unknown>
    if (this.pending.has(requestId)) {
      return Promise.reject(new Error(`rpc requestId already pending: ${requestId}`))
    }
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs === null ? undefined : setTimeout(() => {
        this.pending.delete(requestId)
        reject(deadline.timeoutError?.() ?? new Error(`rpc timeout: ${String(payload.method ?? payload.type)}`))
        deadline.onTimeout?.()
      }, timeoutMs)
      this.pending.set(requestId, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      try {
        send(payload)
      } catch (error) {
        this.pending.delete(requestId)
        clearTimeout(timer)
        reject(error)
      }
    })
  }

  complete(requestId: string, payload: unknown): void {
    const p = this.pending.get(requestId)
    if (!p) return
    this.pending.delete(requestId)
    p.resolve(payload)
  }

  fail(requestId: string, error: unknown): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    pending.reject(error)
  }

  failAll(err: unknown): void {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

}
