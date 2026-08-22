/**
 * Request/response over `superone.node`.
 *
 * The WebView has no host capabilities of its own — toast, clipboard, reveal,
 * and the agent APIs all live in the MiniApp Host. `superone.node.postMessage`
 * is one-way, so this adds an id and resolves the matching reply.
 */
type Pending = { resolve(value: unknown): void; reject(error: Error): void }

let seq = 0
const pending = new Map<number, Pending>()
let listening = false

function listen(): void {
  if (listening) return
  listening = true
  window.superone.node.onMessage((message) => {
    const reply = message as { type?: string; id?: number; result?: unknown; error?: string }
    if (reply?.type !== 'host-rpc-result' || typeof reply.id !== 'number') return
    const entry = pending.get(reply.id)
    if (!entry) return
    pending.delete(reply.id)
    if (reply.error) entry.reject(new Error(reply.error))
    else entry.resolve(reply.result)
  })
}

export function callHost<T = unknown>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  listen()
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    window.superone.node.postMessage({ type: 'host-rpc', id, action, args })
  })
}
