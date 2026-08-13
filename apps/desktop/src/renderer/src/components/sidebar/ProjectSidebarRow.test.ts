/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { groupSidebarSessions, visibleChildSessions } from './ProjectSidebarRow'

function session(sessionId: string, parentSessionId?: string): SessionHistoryEntry {
  return {
    sessionId,
    parentSessionId,
    title: sessionId,
    lastActiveAt: '2026-01-01T00:00:00.000Z',
    messageCount: 0,
  }
}

describe('groupSidebarSessions', () => {
  it('nests collaboration sessions under their parent without hiding unrelated sessions', () => {
    const groups = groupSidebarSessions([
      session('parent'),
      session('child-a', 'parent'),
      session('child-b', 'parent'),
      session('other'),
    ])

    expect(groups.map((group) => group.parent.sessionId)).toEqual(['parent', 'other'])
    expect(groups[0].children.map((child) => child.sessionId)).toEqual(['child-a', 'child-b'])
  })

  it('keeps an orphaned child visible when its parent is outside the loaded page', () => {
    expect(groupSidebarSessions([session('child', 'missing')])[0].parent.sessionId).toBe('child')
  })
})

describe('visibleChildSessions', () => {
  const children = [session('live', 'parent'), session('idle', 'parent'), session('unseen', 'parent')]
  const liveIds = new Set(['live', 'unseen'])
  const isLive = (s: SessionHistoryEntry) => liveIds.has(s.sessionId)

  it('shows every child when the parent list is expanded', () => {
    expect(visibleChildSessions(children, true, isLive).map((c) => c.sessionId)).toEqual([
      'live',
      'idle',
      'unseen',
    ])
  })

  it('keeps only live/unseen children when the parent list is collapsed', () => {
    expect(visibleChildSessions(children, false, isLive).map((c) => c.sessionId)).toEqual([
      'live',
      'unseen',
    ])
  })

  it('hides all children when collapsed and none are live', () => {
    expect(visibleChildSessions([session('idle', 'parent')], false, () => false)).toEqual([])
  })
})
