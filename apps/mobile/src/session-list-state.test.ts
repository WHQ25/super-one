import { describe, expect, it } from 'vitest'
import { flattenSessionGroups, groupSessionRows, type SessionListRow } from './session-list-state'

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

describe('pinned promotion', () => {
  it('lifts a pinned group above unpinned ones without disturbing the rest', () => {
    const rows: SessionListRow[] = [row('a'), { ...row('b'), isPinned: true }, row('c')]
    expect(groupSessionRows(rows).map((group) => group.parent.sessionId)).toEqual(['b', 'a', 'c'])
  })

  it('keeps a pinned child under its parent instead of promoting it', () => {
    const rows: SessionListRow[] = [row('a'), { ...row('a1', 'a'), isPinned: true }, row('b')]
    const items = flattenSessionGroups(rows, new Set(['a']))
    expect(items.map((item) => item.session.sessionId)).toEqual(['a', 'a1', 'b'])
  })
})

