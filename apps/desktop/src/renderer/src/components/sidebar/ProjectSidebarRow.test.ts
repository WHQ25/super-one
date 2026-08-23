/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import type { ScheduledSend, SessionHistoryEntry } from '@superone/shared/agent-types'
import { groupSidebarSessions, orderScheduledGroupsFirst, visibleChildSessions } from './ProjectSidebarRow'

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

describe('orderScheduledGroupsFirst', () => {
  function queued(sessionId: string, sendAt: number, armed = true): ScheduledSend {
    return { sessionId, sendAt, message: null, armed, source: 'manual' }
  }

  function byId(...rows: ScheduledSend[]): Record<string, ScheduledSend> {
    return Object.fromEntries(rows.map((row) => [row.sessionId, row]))
  }

  const groups = groupSidebarSessions([session('a'), session('b'), session('c')])

  it('floats the sessions that owe a send above the rest, soonest first', () => {
    const ordered = orderScheduledGroupsFirst(groups, byId(queued('c', 200), queued('a', 100)))
    expect(ordered.map((group) => group.parent.sessionId)).toEqual(['a', 'c', 'b'])
  })

  it('leaves the unscheduled remainder in the order it arrived', () => {
    const ordered = orderScheduledGroupsFirst(groups, byId(queued('b', 100)))
    expect(ordered.map((group) => group.parent.sessionId)).toEqual(['b', 'a', 'c'])
  })

  it('ignores an offer nobody has answered', () => {
    // Unarmed is a question, not a promise — reordering for it would announce
    // something the user never agreed to.
    const ordered = orderScheduledGroupsFirst(groups, byId(queued('c', 100, false)))
    expect(ordered).toBe(groups)
  })

  it('ignores a schedule on a collaboration child', () => {
    const nested = groupSidebarSessions([session('a'), session('b'), session('kid', 'b')])
    // The child sits inside its parent's group and is not even drawn while that
    // group is collapsed, so lifting the group would move a row for a reason
    // the user cannot see.
    expect(orderScheduledGroupsFirst(nested, byId(queued('kid', 100)))).toBe(nested)
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
