import { describe, expect, it } from 'vitest'
import { registerFatalChatViewError } from './chat-view-recovery'

describe('chat WebView fatal recovery', () => {
  it('reloads twice, stops a crash loop, and resets after the recovery window', () => {
    let state = { startedAt: 0, count: 0 }
    const first = registerFatalChatViewError(state, 1_000)
    state = first.state
    expect(first.reload).toBe(true)
    const second = registerFatalChatViewError(state, 1_100)
    state = second.state
    expect(second.reload).toBe(true)
    const loop = registerFatalChatViewError(state, 1_200)
    expect(loop.reload).toBe(false)
    const recovered = registerFatalChatViewError(loop.state, 12_000)
    expect(recovered).toEqual({ state: { startedAt: 12_000, count: 1 }, reload: true })
  })
})
