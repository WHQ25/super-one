import { describe, expect, it } from 'vitest'
import {
  CHAT_WINDOW,
  initialChatWindow,
  loadPreviousChatWindow,
  normalizeChatWindow,
} from './chat-window'

describe('chat DOM window', () => {
  it('starts at the latest 24 turns', () => {
    expect(initialChatWindow(60)).toEqual({ start: 36, end: 60 })
    expect(initialChatWindow(8)).toEqual({ start: 0, end: 8 })
  })

  it('loads eight older turns at a time', () => {
    expect(loadPreviousChatWindow({ start: 36, end: 60 }, 60))
      .toEqual({ start: 28, end: 60 })
  })

  it('never mounts more than forty turns', () => {
    expect(normalizeChatWindow({ start: 0, end: 80 }, 100))
      .toEqual({ start: 40, end: 80 })
    expect(CHAT_WINDOW.maxMountedTurns).toBe(40)
  })

  it('clamps invalid host ranges', () => {
    expect(normalizeChatWindow({ start: -20, end: 500 }, 12))
      .toEqual({ start: 0, end: 12 })
  })
})
