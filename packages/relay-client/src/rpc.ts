import type { RemoteCommand } from '@superone/shared/agent-types'
import { encryptPayload } from './crypto'

export type PendingRpc = {
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
}

export class RpcInbox {
  private readonly pending = new Map<string, PendingRpc>()
  private readonly chunks = new Map<string, Array<string | null>>()

  constructor(private readonly id: () => string = () => crypto.randomUUID()) {}

  begin(command: RemoteCommand, send: (frame: unknown) => void, aesKeyBytes: Uint8Array, timeoutMs = 15_000): Promise<unknown> {
    const requestId = 'requestId' in command && typeof command.requestId === 'string' && command.requestId
      ? command.requestId
      : this.id()
    const payload = { ...command, requestId } as Record<string, unknown>
    if (this.pending.has(requestId)) {
      return Promise.reject(new Error(`rpc requestId already pending: ${requestId}`))
    }
    const data = encryptPayload(aesKeyBytes, payload)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        this.chunks.delete(requestId)
        reject(new Error(`rpc timeout: ${String(payload.type)}`))
      }, timeoutMs)
      this.pending.set(requestId, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      try {
        send({ type: 'command', data })
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
    this.chunks.delete(requestId)
    p.resolve(payload)
  }

  fail(requestId: string, error: unknown): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    this.chunks.delete(requestId)
    pending.reject(error)
  }

  failAll(err: unknown): void {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    this.chunks.clear()
  }

  ingestChunk(requestId: string, index: number, total: number, data: string): string | null {
    if (!Number.isSafeInteger(total) || total <= 0 || total > 10_000) {
      throw new Error(`invalid rpc chunk total: ${total}`)
    }
    if (!Number.isSafeInteger(index) || index < 0 || index >= total) {
      throw new Error(`invalid rpc chunk index: ${index}`)
    }
    if (!this.pending.has(requestId)) throw new Error(`unknown rpc chunk request: ${requestId}`)
    let slots = this.chunks.get(requestId)
    if (!slots) {
      slots = Array.from({ length: total }, () => null)
      this.chunks.set(requestId, slots)
    } else if (slots.length !== total) {
      this.chunks.delete(requestId)
      throw new Error(`rpc chunk total changed for ${requestId}`)
    }
    slots[index] = data
    if (slots.every((c) => c != null)) {
      this.chunks.delete(requestId)
      return slots.join('')
    }
    return null
  }
}
