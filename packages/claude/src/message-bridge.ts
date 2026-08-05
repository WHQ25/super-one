/**
 * AsyncIterable prompt bridge for the Claude Agent SDK.
 *
 * Desktop SuperOne uses the same pattern (apps/desktop message-bridge): a
 * long-lived `query({ prompt: bridge })` waits on this iterable; subsequent
 * user turns are `push()`ed in with optional priority tags instead of
 * spawning a new SDK process.
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

interface TaggedMessage {
  msg: SDKUserMessage
  tag?: string
}

export class MessageBridge {
  private queue: TaggedMessage[] = []
  private waiter: { resolve: (v: IteratorResult<SDKUserMessage>) => void } | null = null
  private closed = false
  private readonly _consumedTags: string[] = []
  private _onConsumed: ((tag: string) => void) | null = null

  get consumedTags(): readonly string[] {
    return this._consumedTags
  }

  set onConsumed(cb: ((tag: string) => void) | null) {
    this._onConsumed = cb
  }

  push(msg: SDKUserMessage, tag?: string): void {
    if (this.closed) return

    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      if (tag) {
        this._consumedTags.push(tag)
        this._onConsumed?.(tag)
      }
      w.resolve({ value: msg, done: false })
    } else {
      this.queue.push({ msg, tag })
    }
  }

  close(): void {
    this.closed = true
    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      w.resolve({ value: undefined as unknown as SDKUserMessage, done: true })
    }
  }

  get isClosed(): boolean {
    return this.closed
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) {
          const item = this.queue.shift()!
          if (item.tag) {
            this._consumedTags.push(item.tag)
            this._onConsumed?.(item.tag)
          }
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
