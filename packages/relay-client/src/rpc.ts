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
    const data = encryptPayload(aesKeyBytes, payload)
    send({ type: 'command', data })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`rpc timeout: ${String(payload.type)}`))
      }, timeoutMs)
      this.pending.set(requestId, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
    })
  }

  complete(requestId: string, payload: unknown): void {
    const p = this.pending.get(requestId)
    if (!p) return
    this.pending.delete(requestId)
    p.resolve(payload)
  }

  failAll(err: unknown): void {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    this.chunks.clear()
  }

  ingestChunk(requestId: string, index: number, total: number, data: string): string | null {
    let slots = this.chunks.get(requestId)
    if (!slots) {
      slots = Array.from({ length: total }, () => null)
      this.chunks.set(requestId, slots)
    }
    slots[index] = data
    if (slots.every((c) => c != null)) {
      this.chunks.delete(requestId)
      return slots.join('')
    }
    return null
  }
}
