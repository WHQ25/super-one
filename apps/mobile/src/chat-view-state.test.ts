import { describe, expect, it } from 'vitest'
import { parseStoredChatViewStates } from './chat-view-state'

describe('stored Chat View state', () => {
  it('restores valid state and ignores corrupt storage', () => {
    const raw = JSON.stringify({ session: { type: 'viewState', range: { start: 2, end: 8 }, atBottom: false } })
    expect(parseStoredChatViewStates(raw).session?.range).toEqual({ start: 2, end: 8 })
    expect(parseStoredChatViewStates('{broken')).toEqual({})
  })
})
