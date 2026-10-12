import { describe, expect, it } from 'vitest'
import { sendStartsStreaming, shouldQueueUserSend } from './session-send-request'

describe('shouldQueueUserSend', () => {
  it('holds a send behind a running turn for queueing harnesses only', () => {
    for (const provider of ['claude', 'acp', 'opencode', 'dsh'] as const) {
      expect(shouldQueueUserSend(provider, 'streaming')).toBe(true)
      expect(shouldQueueUserSend(provider, 'idle')).toBe(false)
    }
    expect(shouldQueueUserSend('cursor', 'streaming')).toBe(false)
  })

  it('holds only a plain Codex run; a command such as review goes out at once', () => {
    expect(shouldQueueUserSend('codex', 'streaming', true)).toBe(true)
    expect(shouldQueueUserSend('codex', 'streaming', false)).toBe(false)
  })
})

describe('sendStartsStreaming', () => {
  it('marks a Cursor send streaming unless it was queued', () => {
    expect(sendStartsStreaming('cursor', false)).toBe(true)
    expect(sendStartsStreaming('cursor', true)).toBe(false)
    expect(sendStartsStreaming('claude', false)).toBe(false)
  })
})
