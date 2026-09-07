import { describe, expect, it, vi } from 'vitest'
import type { SessionHistoryEntry } from './agent-types'
import {
  initialSessionMentionLoadState,
  loadSessionMentionPage,
  type SessionMentionPageLoader,
} from './session-mention-query'

/**
 * The grammar is covered end-to-end by the desktop popup's own suite, which
 * exercises this module through its shim. What only exists here is the injected
 * loader contract — in particular that paging follows the loader's `hasMore`
 * rather than inferring it from a full-looking page.
 */

const session = (sessionId: string, title: string): SessionHistoryEntry =>
  ({ sessionId, title, lastActiveAt: '2026-01-01T00:00:00.000Z', messageCount: 1 }) as SessionHistoryEntry

const projects = [
  { projectKey: '/a', label: 'a' },
  { projectKey: '/b', label: 'b' },
]

describe('loadSessionMentionPage', () => {
  it('stops paging a project when the loader says there is no more, even on a full page', async () => {
    // A backend that knows the total can return exactly `limit` rows and still
    // report hasMore: false. Inferring from page length would loop forever.
    const loadPage = vi.fn<SessionMentionPageLoader>(async (projectKey) =>
      projectKey === '/a'
        ? { sessions: [session('1', 'one'), session('2', 'two')], hasMore: false }
        : { sessions: [session('3', 'three')], hasMore: false },
    )

    const { rows, next } = await loadSessionMentionPage({
      scope: { kind: 'all' },
      titleQuery: '',
      projects,
      state: initialSessionMentionLoadState(),
      loadPage,
      pageSize: 2,
    })

    expect(rows.map((r) => r.session.sessionId)).toEqual(['1', '2'])
    // Page filled on project /a, and /a is exhausted → advance to /b.
    expect(next).toEqual({ offset: 0, projectIndex: 1, hasMore: true })
    expect(loadPage).toHaveBeenCalledTimes(1)
  })

  it('keeps scanning across projects until the page is full', async () => {
    const loadPage: SessionMentionPageLoader = async (projectKey) =>
      projectKey === '/a'
        ? { sessions: [session('1', 'one')], hasMore: false }
        : { sessions: [session('2', 'two')], hasMore: false }

    const { rows, next } = await loadSessionMentionPage({
      scope: { kind: 'all' },
      titleQuery: '',
      projects,
      state: initialSessionMentionLoadState(),
      loadPage,
      pageSize: 5,
    })

    expect(rows.map((r) => r.projectLabel)).toEqual(['a', 'b'])
    expect(next.hasMore).toBe(false)
  })

  it('filters by title and reports the project each row came from', async () => {
    const loadPage: SessionMentionPageLoader = async (projectKey) =>
      projectKey === '/a'
        ? { sessions: [session('1', 'align the popup'), session('2', 'unrelated')], hasMore: false }
        : { sessions: [session('3', 'alignment pass')], hasMore: false }

    const { rows } = await loadSessionMentionPage({
      scope: { kind: 'all' },
      titleQuery: 'align',
      projects,
      state: initialSessionMentionLoadState(),
      loadPage,
    })

    expect(rows.map((r) => [r.session.sessionId, r.projectLabel])).toEqual([['1', 'a'], ['3', 'b']])
  })

  it('returns nothing when the scope resolves to no projects', async () => {
    const loadPage = vi.fn<SessionMentionPageLoader>()

    const { rows, next } = await loadSessionMentionPage({
      scope: { kind: 'all' },
      titleQuery: '',
      projects: [],
      state: initialSessionMentionLoadState(),
      loadPage,
    })

    expect(rows).toEqual([])
    expect(next.hasMore).toBe(false)
    expect(loadPage).not.toHaveBeenCalled()
  })
})
