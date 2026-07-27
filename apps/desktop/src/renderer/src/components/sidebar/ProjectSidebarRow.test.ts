import { describe, expect, it } from 'vitest'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { groupSidebarSessions } from './ProjectSidebarRow'

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
