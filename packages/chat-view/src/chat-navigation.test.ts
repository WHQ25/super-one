import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { extractTurnOutline } from '@superone/shared/turn-outline'
import { findActiveTurnId, tickWidth } from '@superone/shared/chat-scroll-indicator'
import { compactMessageIndices, compactVisibleStart, jumpChatWindow, visibleChatWindow } from './chat-navigation'
import { loadNextChatWindow, loadPreviousChatWindow } from './chat-window'

const message = (id: string, role: ChatMessage['role'], text: string, providerId = 'claude'): ChatMessage => ({
  id, role, content: [{ type: 'text', text }], providerId, status: 'complete', createdAt: '2026-09-08T00:00:00Z',
})

describe('desktop outline in a bounded mobile transcript', () => {
  it('uses user questions with their first text reply, skipping system markers and tool-only replies', () => {
    const messages = [message('u1', 'user', 'Title\nDetails'), message('tool', 'assistant', ''),
      message('compact', 'assistant', '__compact__:auto:200', 'system'), message('a1', 'assistant', 'Answer'),
      message('image-only', 'user', ''), message('a2', 'assistant', 'Image description'), message('u3', 'user', 'Next')]
    expect(extractTurnOutline(messages)).toEqual([
      { id: 'u1', index: 0, text: 'Title\nDetails', reply: 'Answer', createdAt: messages[0]!.createdAt },
      { id: 'u3', index: 6, text: 'Next', reply: undefined, createdAt: messages[0]!.createdAt },
    ])
    expect(compactMessageIndices(messages)).toEqual([2])
  })
  it('does not mistake unmounted later turns for preceding turns', () => {
    const entries = ['old', 'current', 'next', 'future'].map((id) => ({ id }))
    const tops: Record<string, number | null> = { old: null, current: 20, next: 400, future: Infinity }
    expect(findActiveTurnId(entries, (id) => tops[id]!, 200)).toBe('current')
  })
  it('keeps the desktop tick magnification curve', () => {
    expect([null, 0, 1, 2, 3, 4].map(tickWidth)).toEqual([6, 22, 20, 14, 8, 6])
  })
  it('expands each compact boundary and all history with the same levels as desktop', () => {
    expect([0, 1, 2, 3].map((level) => compactVisibleStart([10, 50, 90], level))).toEqual([90, 50, 10, 0])
    expect(visibleChatWindow({ start: 76, end: 100 }, 100, 90)).toEqual({ start: 90, end: 100 })
  })
  it('mounts a bounded neighborhood containing any jump target', () => {
    for (let index = 0; index < 200; index++) {
      const range = jumpChatWindow(index, 200)
      expect(range.start).toBeLessThanOrEqual(index)
      expect(range.end).toBeGreaterThan(index)
      expect(range.end - range.start).toBeLessThanOrEqual(24)
    }
  })
  it('can traverse all history in both directions after reaching the DOM ceiling', () => {
    let range = { start: 176, end: 200 }
    for (let i = 0; i < 25; i++) range = loadPreviousChatWindow(range, 200)
    expect(range).toEqual({ start: 0, end: 40 })
    for (let i = 0; i < 25; i++) range = loadNextChatWindow(range, 200)
    expect(range).toEqual({ start: 160, end: 200 })
  })
})
