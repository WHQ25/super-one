import { describe, expect, it } from 'vitest'
import { CHAT_WINDOW } from './chat-window'

describe('CHAT_WINDOW fail-closed budgets (WP-06)', () => {
  it('caps the mounted DOM below the 200-turn stress corpus', () => {
    expect(CHAT_WINDOW.maxMountedTurns).toBeLessThan(200)
    expect(CHAT_WINDOW.initialTurns).toBeLessThanOrEqual(CHAT_WINDOW.maxMountedTurns)
    expect(CHAT_WINDOW.loadMoreTurns).toBeGreaterThan(0)
  })

  it('matches the shared 33 ms envelope and markdown throttle', () => {
    expect(CHAT_WINDOW.envelopeMs).toBe(33)
    expect(CHAT_WINDOW.streamingThrottleMs).toBe(33)
  })

  it('keeps the RSS and frame gates from the migration plan', () => {
    expect(CHAT_WINDOW.rssBudgetMb).toBe(250)
    expect(CHAT_WINDOW.frameP95Ms).toBe(20)
  })
})
