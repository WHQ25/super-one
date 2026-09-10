import { describe, expect, it } from 'vitest'
import {
  flattenSessionGroups,
  groupSessionRows,
  mergeActivityIntoRows,
  partitionSessionGroups,
  sessionListInvalidations,
  visibleSessionGroups,
  type SessionListRow,
} from './session-list-state'

function row(sessionId: string, parentSessionId?: string): SessionListRow {
  return { sessionId, title: sessionId, ...(parentSessionId ? { parentSessionId } : {}) }
}

const NONE = new Set<string>()

describe('groupSessionRows', () => {
  it('nests collaboration children under their parent', () => {
    const groups = groupSessionRows([row('a'), row('a1', 'a'), row('a2', 'a'), row('b')])
    expect(groups.map((group) => group.parent.sessionId)).toEqual(['a', 'b'])
    expect(groups[0].children.map((child) => child.sessionId)).toEqual(['a1', 'a2'])
    expect(groups[1].children).toEqual([])
  })

  it('keeps a child whose parent is outside the loaded page as a root', () => {
    const groups = groupSessionRows([row('a1', 'missing'), row('b')])
    expect(groups.map((group) => group.parent.sessionId)).toEqual(['a1', 'b'])
  })
})

describe('flattenSessionGroups', () => {
  it('hides children of a collapsed parent and marks it collapsed', () => {
    const items = flattenSessionGroups([row('a'), row('a1', 'a'), row('b')], NONE)
    expect(items.map((item) => item.session.sessionId)).toEqual(['a', 'b'])
    expect(items[0]).toMatchObject({ child: false, hasChildren: true, collapsed: true })
    expect(items[1]).toMatchObject({ hasChildren: false, collapsed: false })
  })

  it('renders children indented once the parent is expanded', () => {
    const items = flattenSessionGroups([row('a'), row('a1', 'a')], new Set(['a']))
    expect(items.map((item) => item.session.sessionId)).toEqual(['a', 'a1'])
    expect(items[0].collapsed).toBe(false)
    expect(items[1].child).toBe(true)
  })

  it('keeps the active child visible while its parent stays collapsed', () => {
    const items = flattenSessionGroups([row('a'), row('a1', 'a'), row('a2', 'a')], NONE, 'a2')
    expect(items.map((item) => item.session.sessionId)).toEqual(['a', 'a2'])
    expect(items[0].collapsed).toBe(true)
  })

  it('leaves a childless parent without a toggle', () => {
    const [item] = flattenSessionGroups([row('a')], NONE)
    expect(item).toMatchObject({ hasChildren: false, collapsed: false })
  })
})

describe('pinning does not reorder a project list', () => {
  // Desktop surfaces pins in its cross-project Pinned section only; an expanded
  // project keeps the host's recency order. The drawer does the same.
  it('leaves a pinned group in its host-given position', () => {
    const rows: SessionListRow[] = [row('a'), { ...row('b'), isPinned: true }, row('c')]
    expect(groupSessionRows(rows).map((group) => group.parent.sessionId)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a pinned child under its parent', () => {
    const rows: SessionListRow[] = [row('a'), { ...row('a1', 'a'), isPinned: true }, row('b')]
    const items = flattenSessionGroups(rows, new Set(['a']))
    expect(items.map((item) => item.session.sessionId)).toEqual(['a', 'a1', 'b'])
  })
})


describe('reveal limit', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => row(id))

  it('counts groups, not rows, so a page of children does not fill the list', () => {
    // Six groups, ten rows: the limit must let all six through.
    const rows = [row('a'), row('a1', 'a'), row('a2', 'a'), row('b'), row('b1', 'b'),
      row('c'), row('d'), row('e'), row('f'), row('g')]
    const items = flattenSessionGroups(rows, new Set(['a', 'b']), null, 6)
    expect(items.filter((item) => !item.child).map((item) => item.session.sessionId))
      .toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    // The expanded children ride along with their parent rather than costing slots.
    expect(items.map((item) => item.session.sessionId))
      .toEqual(['a', 'a1', 'a2', 'b', 'b1', 'c', 'd', 'e', 'f'])
  })

  it('holds back everything past the limit', () => {
    expect(visibleSessionGroups(groupSessionRows(many), 6).map((group) => group.parent.sessionId))
      .toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('appends the group holding the active session rather than promoting it', () => {
    const groups = visibleSessionGroups(groupSessionRows(many), 6, 'h')
    expect(groups.map((group) => group.parent.sessionId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'h'])
  })

  it('reaches the active session through its parent group', () => {
    const rows = [...many, row('h1', 'h')]
    const groups = visibleSessionGroups(groupSessionRows(rows), 6, 'h1')
    expect(groups.map((group) => group.parent.sessionId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'h'])
  })

  it('is unbounded when no limit is given', () => {
    expect(visibleSessionGroups(groupSessionRows(many)).length).toBe(8)
  })
})

describe('sessionListInvalidations', () => {
  it('picks the changed projects out of a mixed batch', () => {
    expect(sessionListInvalidations([
      { type: 'content_delta', sessionId: 's1' },
      { type: 'session_list_changed', projectPath: '/repo' },
      { type: 'status_change', sessionId: 's1' },
      { type: 'session_list_changed', projectPath: '/other' },
    ])).toEqual(['/repo', '/other'])
  })

  it('collapses a burst affecting the same project', () => {
    expect(sessionListInvalidations([
      { type: 'session_list_changed', projectPath: '/repo' },
      { type: 'session_list_changed', projectPath: '/repo' },
    ])).toEqual(['/repo'])
  })

  it('ignores malformed frames rather than invalidating on them', () => {
    expect(sessionListInvalidations([
      null,
      'not an event',
      { type: 'session_list_changed' },
      { type: 'session_list_changed', projectPath: 42 },
    ])).toEqual([])
  })
})

it('promotes pending groups ahead of recency, like the desktop sidebar', () => {
  const rows = [
    { sessionId: 'first', title: 'First' },
    { sessionId: 'parent', title: 'Parent' },
    { sessionId: 'child', title: 'Needs input', parentSessionId: 'parent', pendingCount: 1 },
  ]
  expect(flattenSessionGroups(rows, new Set(), null, 1).map(item => item.session.sessionId))
    .toEqual(['parent', 'child'])
})

it('keeps unseen children visible even when their group is collapsed and beyond the reveal limit', () => {
  const rows = [row('first'), row('parent'), { ...row('unread', 'parent'), isUnseen: true }]
  expect(flattenSessionGroups(rows, NONE, null, 1).map(item => item.session.sessionId))
    .toEqual(['parent', 'unread'])
})

describe('attention partition', () => {
  it('puts pending and unseen groups in attention, in host order', () => {
    const groups = groupSessionRows([
      row('idle-a'),
      { ...row('pending'), pendingCount: 1 },
      row('idle-b'),
      { ...row('unread'), isUnseen: true },
    ])
    const sections = partitionSessionGroups(groups)
    expect(sections.attention.map((group) => group.parent.sessionId)).toEqual(['pending', 'unread'])
    expect(sections.normal.map((group) => group.parent.sessionId)).toEqual(['idle-a', 'idle-b'])
  })

  it('shows only attention groups while the project is collapsed', () => {
    const groups = groupSessionRows([
      row('idle'),
      { ...row('pending'), pendingCount: 2 },
      { ...row('unread'), isUnseen: true },
    ])
    expect(visibleSessionGroups(groups, 0).map((group) => group.parent.sessionId))
      .toEqual(['pending', 'unread'])
  })

  it('keeps the active session reachable while a project is collapsed', () => {
    const groups = groupSessionRows([row('idle'), { ...row('pending'), pendingCount: 1 }, row('current')])
    expect(visibleSessionGroups(groups, 0, 'current').map((group) => group.parent.sessionId))
      .toEqual(['pending', 'current'])
  })
})

describe('mergeActivityIntoRows', () => {
  it('overlays pending counts onto listed rows and inserts missing attention sessions', () => {
    const rows: SessionListRow[] = [row('listed'), row('other-project')]
    const merged = mergeActivityIntoRows(rows, {
      listed: {
        sessionId: 'listed', projectPath: '/repo', status: 'idle', pendingCount: 1, provider: 'codex',
      },
      missing: {
        sessionId: 'missing', projectPath: '/repo', status: 'idle', pendingCount: 1,
        title: 'Allow Bash?', provider: 'claude',
      },
      elsewhere: {
        sessionId: 'elsewhere', projectPath: '/other', status: 'idle', pendingCount: 1, title: 'Other',
      },
    }, '/repo')
    expect(merged.map((session) => session.sessionId)).toEqual(['missing', 'listed', 'other-project'])
    expect(merged[0]).toMatchObject({ title: 'Allow Bash?', pendingCount: 1, provider: 'claude' })
    expect(merged[1]?.pendingCount).toBe(1)
  })
})
