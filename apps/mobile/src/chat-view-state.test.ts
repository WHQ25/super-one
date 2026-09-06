import { describe, expect, it } from 'vitest'
import { parseStoredChatViewStates, restoredChatWindow } from './chat-view-state'

describe('stored Chat View state', () => {
  it('restores valid state and ignores corrupt storage', () => {
    const raw = JSON.stringify({ session: { type: 'viewState', range: { start: 2, end: 8 }, atBottom: false } })
    expect(parseStoredChatViewStates(raw).session?.range).toEqual({ start: 2, end: 8 })
    expect(parseStoredChatViewStates('{broken')).toEqual({})
  })
  it('keeps hydration at the latest turn when the saved viewport followed the bottom', () => {
    expect(restoredChatWindow({ type: 'viewState', range: { start: 0, end: 2 }, atBottom: true })).toBeNull()
    expect(restoredChatWindow({ type: 'viewState', range: { start: 0, end: 0 }, atBottom: false })).toBeNull()
  })
  it('restores a nonempty history viewport and its anchor', () => {
    expect(restoredChatWindow({ type: 'viewState', range: { start: 2, end: 8 }, atBottom: false, anchorId: 'turn-3' }))
      .toEqual({ type: 'setWindow', range: { start: 2, end: 8 }, anchorId: 'turn-3' })
  })
})
