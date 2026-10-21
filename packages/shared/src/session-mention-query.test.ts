import { describe, expect, it } from 'vitest'
import {
  buildSessionProjectOptions,
  isSessionMentionQuery,
  listSessionProjectCompletions,
  mentionQueryAllowsSpaces,
  parseSessionMentionQuery,
  remainingSessionArgumentHint,
  SESSION_MENTION_ARGUMENT_HINT,
  SESSION_MENTION_NAV_PREFIX,
  titleMatches,
  type ProjectOption,
} from './session-mention-query'

const projects: ProjectOption[] = [
  { projectKey: '/work/super-one', label: 'super-one' },
  { projectKey: '/work/other', label: 'other' },
  { projectKey: '/work/app-a', label: 'app' },
  { projectKey: '/work/app-b', label: 'app' },
]

describe('isSessionMentionQuery', () => {
  it('matches session and session with a title', () => {
    expect(isSessionMentionQuery('session')).toBe(true)
    expect(isSessionMentionQuery('session ')).toBe(true)
    expect(isSessionMentionQuery('session fix auth')).toBe(true)
  })

  it('rejects colon form and unrelated', () => {
    expect(isSessionMentionQuery('session:')).toBe(false)
    expect(isSessionMentionQuery('sessions')).toBe(false)
    expect(isSessionMentionQuery('chat')).toBe(false)
  })

  it('requires the keyword to follow @ directly', () => {
    expect(isSessionMentionQuery(' session')).toBe(false)
    expect(mentionQueryAllowsSpaces(' session all')).toBe(false)
    expect(parseSessionMentionQuery(' session')).toBeNull()
  })
})

describe('parseSessionMentionQuery', () => {
  it('is recent across every project until something is typed', () => {
    expect(parseSessionMentionQuery('session', { projects })).toEqual({
      phase: 'recent',
      projects: null,
      projectToken: '',
      titleQuery: '',
      scopeNavPrefix: null,
    })
    expect(parseSessionMentionQuery('session ', { projects }).phase).toBe('recent')
  })

  it('treats an unfinished first token as a title and a completion token', () => {
    expect(parseSessionMentionQuery('session sup', { projects })).toMatchObject({
      phase: 'search',
      projects: null,
      projectToken: 'sup',
      titleQuery: 'sup',
      scopeNavPrefix: null,
    })
  })

  it('scopes to every project with that label once whitespace follows it', () => {
    const scoped = parseSessionMentionQuery('session app ', { projects })
    expect(scoped).toMatchObject({
      phase: 'recent',
      projectToken: '',
      titleQuery: '',
      scopeNavPrefix: 'session app ',
    })
    expect(scoped?.projects?.map((project) => project.projectKey)).toEqual(['/work/app-a', '/work/app-b'])

    expect(parseSessionMentionQuery('session Super-One fix login', { projects })).toMatchObject({
      phase: 'search',
      titleQuery: 'fix login',
      projectToken: '',
      scopeNavPrefix: 'session super-one ',
    })
  })

  it('searches the whole rest when the first token is not a project', () => {
    expect(parseSessionMentionQuery('session fix login', { projects })).toMatchObject({
      phase: 'search',
      projects: null,
      projectToken: '',
      titleQuery: 'fix login',
    })
    expect(parseSessionMentionQuery('session nope ', { projects })).toMatchObject({
      phase: 'search',
      projects: null,
      projectToken: '',
      titleQuery: 'nope',
    })
  })

  it('nav prefix is session with trailing space', () => {
    expect(SESSION_MENTION_NAV_PREFIX).toBe('session ')
    expect(isSessionMentionQuery(SESSION_MENTION_NAV_PREFIX)).toBe(true)
  })
})

describe('listSessionProjectCompletions', () => {
  it('prefix-matches, dedupes labels, and puts the current project first', () => {
    const rows = listSessionProjectCompletions(projects, 'a', '/work/app-b')
    expect(rows.map((row) => row.label)).toEqual(['app'])
    expect(rows[0]).toMatchObject({ token: 'app', hint: 'current project', matchIndices: [0] })

    const all = listSessionProjectCompletions(projects, '', '/work/other')
    expect(all.map((row) => row.label)).toEqual(['other', 'app', 'super-one'])
    expect(all.map((row) => row.token)).not.toContain('all')
  })
})

describe('buildSessionProjectOptions', () => {
  it('skips missing folders and keeps the active project', () => {
    const options = buildSessionProjectOptions(
      [{ path: '/work/super-one', name: 'super-one' }, { path: '/gone', missing: true }],
      '/work/extra',
    )
    expect(options.map((option) => option.projectKey)).toEqual(['/work/super-one', '/work/extra'])
    expect(options[1]?.label).toBe('extra')
  })
})

describe('mentionQueryAllowsSpaces', () => {
  it('allows spaces only inside the session grammar', () => {
    expect(mentionQueryAllowsSpaces('session ')).toBe(true)
    expect(mentionQueryAllowsSpaces('session fix auth')).toBe(true)
    expect(mentionQueryAllowsSpaces('file name')).toBe(false)
  })
})

describe('remainingSessionArgumentHint', () => {
  it('shows the full hint, then <title> after a scope, then nothing', () => {
    expect(SESSION_MENTION_ARGUMENT_HINT).toBe('[project] <title>')
    expect(remainingSessionArgumentHint('session', projects)).toBe('[project] <title>')
    expect(remainingSessionArgumentHint('session ', projects)).toBe('[project] <title>')
    expect(remainingSessionArgumentHint('session app ', projects)).toBe('<title>')
    expect(remainingSessionArgumentHint('session app fix', projects)).toBeNull()
    expect(remainingSessionArgumentHint('session auth', projects)).toBeNull()
    expect(remainingSessionArgumentHint('files')).toBeNull()
  })
})

describe('titleMatches', () => {
  it('fuzzy-matches a title', () => {
    expect(titleMatches('Fix Auth Middleware', 'auth')).toBe(true)
    expect(titleMatches('Fix Auth Middleware', 'fam')).toBe(true)
    expect(titleMatches('Fix Auth Middleware', 'zzz')).toBe(false)
  })
})
