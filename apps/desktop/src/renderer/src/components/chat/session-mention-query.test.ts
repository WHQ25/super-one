import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  isSessionMentionQuery,
  mentionQueryAllowsSpaces,
  parseSessionMentionQuery,
  listSessionProjectChoices,
  titleMatches,
  loadSessionMentionPage,
  initialSessionMentionLoadState,
  remainingSessionArgumentHint,
  SESSION_MENTION_NAV_PREFIX,
  SESSION_MENTION_ARGUMENT_HINT,
} from './session-mention-query'

const listSessions = vi.fn()

vi.stubGlobal('window', {
  environment: {
    listSessions,
    listProjects: vi.fn().mockResolvedValue([]),
  },
})

const projects = [
  { projectKey: '/Users/me/super-one', label: 'super-one' },
  { projectKey: '/Users/me/other-app', label: 'other-app' },
  { projectKey: 'remote:c1:/work/api', label: 'api' },
]

describe('isSessionMentionQuery', () => {
  it('matches session and session with args', () => {
    expect(isSessionMentionQuery('session')).toBe(true)
    expect(isSessionMentionQuery('session ')).toBe(true)
    expect(isSessionMentionQuery('session all')).toBe(true)
    expect(isSessionMentionQuery('session fix auth')).toBe(true)
  })

  it('rejects colon form and unrelated', () => {
    expect(isSessionMentionQuery('session:')).toBe(false)
    expect(isSessionMentionQuery('sessions')).toBe(false)
    expect(isSessionMentionQuery('chat')).toBe(false)
  })
})

describe('parseSessionMentionQuery phases', () => {
  it('session alone → pick-project', () => {
    const p = parseSessionMentionQuery('session', {
      currentProjectKey: '/Users/me/super-one',
      projects,
    })
    expect(p?.phase).toBe('pick-project')
    expect(p?.projectToken).toBe('')
  })

  it('session partial project → pick-project', () => {
    const p = parseSessionMentionQuery('session sup', {
      currentProjectKey: '/Users/me/super-one',
      projects,
    })
    expect(p?.phase).toBe('pick-project')
    expect(p?.projectToken).toBe('sup')
  })

  it('session all → need-title (title required)', () => {
    const p = parseSessionMentionQuery('session all ', {
      currentProjectKey: '/Users/me/super-one',
      projects,
    })
    expect(p?.phase).toBe('need-title')
    expect(p?.scope).toEqual({ kind: 'all' })
    expect(p?.titleQuery).toBe('')
  })

  it('session all auth → search', () => {
    const p = parseSessionMentionQuery('session all auth refresh', {
      currentProjectKey: '/Users/me/super-one',
      projects,
    })
    expect(p?.phase).toBe('search')
    expect(p?.scope).toEqual({ kind: 'all' })
    expect(p?.titleQuery).toBe('auth refresh')
  })

  it('session super-one mid → search on project', () => {
    const p = parseSessionMentionQuery('session super-one middleware', {
      currentProjectKey: '/Users/me/other-app',
      projects,
    })
    expect(p?.phase).toBe('search')
    expect(p?.scope).toEqual({
      kind: 'project',
      projectKey: '/Users/me/super-one',
      label: 'super-one',
    })
    expect(p?.titleQuery).toBe('middleware')
  })

  it('does not treat bare title as current-project search without project token', () => {
    const p = parseSessionMentionQuery('session fix login', {
      currentProjectKey: '/Users/me/super-one',
      projects,
    })
    // "fix" is not a project → pick-project with token fix
    expect(p?.phase).toBe('pick-project')
    expect(p?.projectToken).toBe('fix')
  })

  it('nav prefix is session with trailing space', () => {
    expect(SESSION_MENTION_NAV_PREFIX).toBe('session ')
    expect(isSessionMentionQuery(SESSION_MENTION_NAV_PREFIX)).toBe(true)
  })
})

describe('listSessionProjectChoices', () => {
  it('includes all + projects filtered by token', () => {
    const choices = listSessionProjectChoices(projects, 'sup', '/Users/me/super-one')
    expect(choices.some((c) => c.token === 'all')).toBe(false) // "sup" does not match all
    expect(choices.map((c) => c.token)).toContain('super-one')
    expect(choices.map((c) => c.token)).not.toContain('other-app')
  })

  it('lists all projects when token empty', () => {
    const choices = listSessionProjectChoices(projects, '', '/Users/me/super-one')
    expect(choices[0]?.token).toBe('all')
    expect(choices[0]?.label).toBe('All Projects')
    expect(choices.map((c) => c.token)).toContain('super-one')
  })
})

describe('mentionQueryAllowsSpaces', () => {
  it('allows spaces only inside @session grammar', () => {
    expect(mentionQueryAllowsSpaces('session ')).toBe(true)
    expect(mentionQueryAllowsSpaces('session all auth')).toBe(true)
    expect(mentionQueryAllowsSpaces('file name')).toBe(false)
  })
})

describe('remainingSessionArgumentHint', () => {
  const projects = [{ projectKey: '/Users/me/super-one', label: 'super-one' }]

  it('shows full grammar while picking project', () => {
    expect(remainingSessionArgumentHint('session', projects)).toBe(SESSION_MENTION_ARGUMENT_HINT)
    expect(remainingSessionArgumentHint('session ', projects)).toBe(SESSION_MENTION_ARGUMENT_HINT)
    expect(remainingSessionArgumentHint('session sup', projects)).toBe(SESSION_MENTION_ARGUMENT_HINT)
  })

  it('shows <title> after project/all is committed', () => {
    expect(remainingSessionArgumentHint('session all ')).toBe('<title>')
    expect(remainingSessionArgumentHint('session all')).toBe(SESSION_MENTION_ARGUMENT_HINT)
    expect(remainingSessionArgumentHint('session super-one ', projects)).toBe('<title>')
  })

  it('keeps full grammar when project list is empty (cannot resolve label)', () => {
    expect(remainingSessionArgumentHint('session super-one ')).toBe(SESSION_MENTION_ARGUMENT_HINT)
  })

  it('hides once title is being typed', () => {
    expect(remainingSessionArgumentHint('session all auth')).toBeNull()
    expect(remainingSessionArgumentHint('session super-one auth', projects)).toBeNull()
  })
})

describe('titleMatches', () => {
  it('fuzzy-matches title (not require contiguous substring)', () => {
    expect(titleMatches('Fix Auth Middleware', 'auth')).toBe(true)
    expect(titleMatches('Fix Auth Middleware', 'fam')).toBe(true) // F…A…M
    expect(titleMatches('Fix Auth Middleware', 'zzz')).toBe(false)
  })
})

describe('SESSION_MENTION_ARGUMENT_HINT', () => {
  it('uses spaced pipe in ghost grammar', () => {
    expect(SESSION_MENTION_ARGUMENT_HINT).toBe('<project | all> <title>')
  })
})

describe('loadSessionMentionPage', () => {
  beforeEach(() => {
    listSessions.mockReset()
  })

  it('loads recent sessions when title query is empty', async () => {
    listSessions.mockResolvedValueOnce([
      { sessionId: 'a', title: 'Auth fix', lastActiveAt: '3', messageCount: 1 },
      { sessionId: 'b', title: 'Unrelated', lastActiveAt: '2', messageCount: 1 },
    ])
    const { rows, next } = await loadSessionMentionPage({
      scope: { kind: 'project', projectKey: '/Users/me/super-one', label: 'super-one' },
      titleQuery: '',
      projects,
      state: initialSessionMentionLoadState(),
      pageSize: 30,
    })
    expect(rows.map((r) => r.session.sessionId)).toEqual(['a', 'b'])
    expect(listSessions).toHaveBeenCalled()
    // Full page not returned → no more
    expect(next.hasMore).toBe(false)
  })

  it('filters by title when searching', async () => {
    listSessions.mockResolvedValueOnce([
      { sessionId: 'a', title: 'Auth fix', lastActiveAt: '1', messageCount: 1 },
      { sessionId: 'b', title: 'Unrelated', lastActiveAt: '1', messageCount: 1 },
      { sessionId: 'c', title: 'more auth', lastActiveAt: '1', messageCount: 1 },
    ])
    const { rows } = await loadSessionMentionPage({
      scope: { kind: 'project', projectKey: '/Users/me/super-one', label: 'super-one' },
      titleQuery: 'auth',
      projects,
      state: initialSessionMentionLoadState(),
      pageSize: 30,
    })
    expect(rows.map((r) => r.session.sessionId)).toEqual(['a', 'c'])
  })
})
