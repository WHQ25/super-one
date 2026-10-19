import { describe, expect, it } from 'vitest'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import { DesktopSessionReads, pageSessionRows } from './desktop-session-reads'

function row(sessionId: string, parentSessionId?: string): DesktopSessionRow {
  return {
    sessionId,
    projectId: 'p1',
    projectPath: '/work/app',
    title: sessionId,
    harnessId: 'claude',
    providerId: 'claude',
    providerSessionId: null,
    worktreePath: null,
    isPinned: false,
    isHidden: false,
    isUserRenamed: false,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    controller: null,
    ...(parentSessionId ? { parentSessionId } : {}),
  }
}

class Reads extends DesktopSessionReads<DesktopSessionRow> {}

const family = [
  row('a'),
  row('b'),
  row('parent'),
  row('child', 'parent'),
  row('child-2', 'parent'),
  row('c'),
]

describe('pageSessionRows', () => {
  it('keeps a spawn family together when the limit falls inside it', () => {
    const page = pageSessionRows(family, 0, 3)
    expect(page.map((entry) => entry.sessionId)).toEqual(['a', 'b', 'parent', 'child', 'child-2'])
    expect(pageSessionRows(family, page.length, 3).map((entry) => entry.sessionId)).toEqual(['c'])
  })

  it('keeps a page that already ends on a family boundary at the limit', () => {
    expect(pageSessionRows([row('a'), row('b'), row('c')], 0, 2).map((entry) => entry.sessionId)).toEqual(['a', 'b'])
  })
})

describe('DesktopSessionReads.list', () => {
  it('returns a child on the same page as its parent', () => {
    const reads = new Reads({
      environmentId: 'desktop',
      sessions: { getSession: () => null, onSession: () => () => {} } as never,
      rows: {
        get: () => null,
        list: () => family,
        loadMessages: () => ({ messages: [], cursor: null, hasMore: false }),
      },
      events: {} as never,
    })
    const page = reads.list('p1', { limit: 3, offset: 0 })
    expect(page.map((entry) => entry.sessionId)).toEqual(['a', 'b', 'parent', 'child', 'child-2'])
    expect(page.find((entry) => entry.sessionId === 'child')?.parentSessionId).toBe('parent')
  })
})
