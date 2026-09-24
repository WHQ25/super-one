import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { extractTurnOutline } from '@superone/shared/turn-outline'
import { findActiveTurnId, tickWidth } from '@superone/shared/chat-scroll-indicator'
import { compactBoundary, compactMessageIndices, compactsAfter, compactTimeline, compactVisibleStart, jumpChatWindow, visibleChatWindow } from './chat-navigation'
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
    const messages = Array.from({ length: 100 }, (_, i) => [10, 50, 90].includes(i)
      ? message(`m${i}`, 'assistant', '__compact__:auto:200', 'system') : message(`m${i}`, 'user', `Q${i}`))
    const timeline = compactTimeline(messages, null)
    expect([0, 1, 2, 3].map((level) => compactVisibleStart(messages, timeline, level))).toEqual([90, 50, 10, 0])
    expect([0, 1, 2, 3].map((level) => compactBoundary(timeline, level))).toEqual(['m90', 'm50', 'm10', undefined])
    expect(['m95', 'm60', 'm0'].map((id) => compactsAfter(timeline, id))).toEqual([0, 1, 3])
    expect(visibleChatWindow({ start: 76, end: 100 }, 100, 90)).toEqual({ start: 90, end: 100 })
  })
  it('collapses on unloaded compacts from the history index, and on ones newer than it', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `m${i}`)
    const index = { messageIds: ids, entries: [], compacts: [{ id: 'm15', index: 15 }, { id: 'm55', index: 55 }] }
    const tail = ids.slice(92).map((id) => message(id, 'user', id))
    const timeline = compactTimeline(tail, index)
    expect(timeline.ids).toEqual(['m15', 'm55'])
    // The latest compact is not loaded: every loaded row lies below it.
    expect(compactVisibleStart(tail, timeline, 0)).toBe(0)
    expect(compactsAfter(timeline, 'm20')).toBe(1)
    const live = [...tail, message('live-compact', 'assistant', '__compact__:manual:10', 'system'), message('next', 'user', 'Next')]
    const extended = compactTimeline(live, index)
    expect(extended.ids).toEqual(['m15', 'm55', 'live-compact'])
    expect(extended.position('live-compact')).toBe(100)
    expect(compactVisibleStart(live, extended, 0)).toBe(8)
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
