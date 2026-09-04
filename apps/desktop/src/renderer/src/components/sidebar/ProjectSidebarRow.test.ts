/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import type { ScheduledSend, SessionHistoryEntry } from '@superone/shared/agent-types'
import {
  groupSidebarSessions,
  partitionSidebarSessionGroups,
  visibleChildSessions,
  visibleSidebarSessionGroups,
} from './ProjectSidebarRow'

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

describe('partitionSidebarSessionGroups', () => {
  function queued(sessionId: string, sendAt: number, armed = true): ScheduledSend {
    return { sessionId, sendAt, message: null, armed, source: 'manual' }
  }

  function byId(...rows: ScheduledSend[]): Record<string, ScheduledSend> {
    return Object.fromEntries(rows.map((row) => [row.sessionId, row]))
  }

  it('partitions attention, scheduled, and normal groups in priority order', () => {
    const groups = groupSidebarSessions([
      session('normal-a'),
      session('scheduled-later'),
      session('attention'),
      session('scheduled-sooner'),
      session('normal-b'),
    ])

    const sections = partitionSidebarSessionGroups(
      groups,
      byId(queued('scheduled-later', 200), queued('scheduled-sooner', 100)),
      (entry) => entry.sessionId === 'attention',
    )

    expect(sections.attention.map((group) => group.parent.sessionId)).toEqual(['attention'])
    expect(sections.scheduled.map((group) => group.parent.sessionId)).toEqual([
      'scheduled-sooner',
      'scheduled-later',
    ])
    expect(sections.normal.map((group) => group.parent.sessionId)).toEqual(['normal-a', 'normal-b'])
  })

  it('keeps an attention session in group one even when it also has a schedule', () => {
    const groups = groupSidebarSessions([session('attention'), session('normal')])
    const sections = partitionSidebarSessionGroups(
      groups,
      byId(queued('attention', 100)),
      (entry) => entry.sessionId === 'attention',
    )

    expect(sections.attention.map((group) => group.parent.sessionId)).toEqual(['attention'])
    expect(sections.scheduled).toEqual([])
  })

  it('puts a parent group in attention when its collaboration child needs attention', () => {
    const groups = groupSidebarSessions([session('normal'), session('parent'), session('child', 'parent')])
    const sections = partitionSidebarSessionGroups(
      groups,
      {},
      (entry) => entry.sessionId === 'child',
    )

    expect(sections.attention.map((group) => group.parent.sessionId)).toEqual(['parent'])
    expect(sections.normal.map((group) => group.parent.sessionId)).toEqual(['normal'])
  })

  it('treats unarmed schedules and schedules on children as normal', () => {
    const groups = groupSidebarSessions([session('parent'), session('child', 'parent'), session('unarmed')])
    const sections = partitionSidebarSessionGroups(
      groups,
      byId(queued('child', 100), queued('unarmed', 200, false)),
      () => false,
    )

    expect(sections.scheduled).toEqual([])
    expect(sections.normal.map((group) => group.parent.sessionId)).toEqual(['parent', 'unarmed'])
  })
})

describe('visibleSidebarSessionGroups', () => {
  const groups = groupSidebarSessions([
    session('attention-a'),
    session('attention-b'),
    session('scheduled-a'),
    session('scheduled-b'),
    session('normal-a'),
    session('normal-b'),
    session('normal-c'),
  ])
  const sections = {
    attention: groups.slice(0, 2),
    scheduled: groups.slice(2, 4),
    normal: groups.slice(4),
  }

  it('shows only attention groups while the project is collapsed', () => {
    const visible = visibleSidebarSessionGroups(sections, false, 6)

    expect(visible.map((group) => group.parent.sessionId)).toEqual([
      'attention-a',
      'attention-b',
    ])
  })

  it('shows all attention and scheduled groups before filling with normal groups', () => {
    const visible = visibleSidebarSessionGroups(sections, true, 6)

    expect(visible.map((group) => group.parent.sessionId)).toEqual([
      'attention-a',
      'attention-b',
      'scheduled-a',
      'scheduled-b',
      'normal-a',
      'normal-b',
    ])
  })

  it('never truncates attention or scheduled groups when they exceed the display limit', () => {
    const requiredGroups = groupSidebarSessions([
      session('attention-a'),
      session('attention-b'),
      session('attention-c'),
      session('scheduled-a'),
      session('scheduled-b'),
    ])
    const visible = visibleSidebarSessionGroups({
      attention: requiredGroups.slice(0, 3),
      scheduled: requiredGroups.slice(3),
      normal: [],
    }, true, 2)

    expect(visible).toEqual(requiredGroups)
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
