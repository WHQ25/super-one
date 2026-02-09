import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * Push-pull async iterable connecting IPC calls to the SDK's streaming input.
 * Messages are pushed via push() and consumed by the SDK's query() function.
 */
export class MessageBridge {
  private queue: SDKUserMessage[] = []
  private waiter: { resolve: (v: IteratorResult<SDKUserMessage>) => void } | null = null
  private closed = false

  /** Push a user message. If the SDK is waiting, it receives it immediately. */
  push(msg: SDKUserMessage): void {
    if (this.closed) return

    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      w.resolve({ value: msg, done: false })
    } else {
      this.queue.push(msg)
    }
  }

  /** Close the bridge, signaling end of input to the SDK. */
  close(): void {
    this.closed = true
    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      w.resolve({ value: undefined as unknown as SDKUserMessage, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true })
        }
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waiter = { resolve }
        })
      },
    }
  }
}
