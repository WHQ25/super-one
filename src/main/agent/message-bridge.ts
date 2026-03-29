import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

interface TaggedMessage {
  msg: SDKUserMessage
  tag?: string
}

export class MessageBridge {
  private queue: TaggedMessage[] = []
  private waiter: { resolve: (v: IteratorResult<SDKUserMessage>) => void } | null = null
  private closed = false
  private _consumedTags: string[] = []

  get consumedTags(): readonly string[] {
    return this._consumedTags
  }

  drainConsumedTag(): string | undefined {
    return this._consumedTags.shift()
  }

  push(msg: SDKUserMessage, tag?: string): void {
    if (this.closed) return

    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      if (tag) this._consumedTags.push(tag)
      w.resolve({ value: msg, done: false })
    } else {
      this.queue.push({ msg, tag })
    }
  }

  dequeue(tag: string): boolean {
    const idx = this.queue.findIndex((item) => item.tag === tag)
    if (idx === -1) return false
    this.queue.splice(idx, 1)
    return true
  }

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
          const item = this.queue.shift()!
          if (item.tag) this._consumedTags.push(item.tag)
          return Promise.resolve({ value: item.msg, done: false })
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
