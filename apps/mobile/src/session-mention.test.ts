import { describe, expect, it } from 'vitest'
import type { SessionListRow } from './session-list-state'
import {
  isSessionMentionQuery, parseSessionQuery, sessionEmptyLabel, sessionItems, sessionProjectItems, sessionProjectOptions,
} from './session-mention'
import { buildMentionRows, groupMentionRows } from './mention-rows'

const projects = [{ path: '/work/super-one', name: 'super-one' }, { path: '/work/relay', name: 'relay' }]
const options = sessionProjectOptions(projects, '/work/super-one')

describe('session mention query', () => {
  it('opens on the portal keyword and nothing else', () => {
    expect(isSessionMentionQuery('session')).toBe(true)
    expect(isSessionMentionQuery('session fix login')).toBe(true)
    expect(isSessionMentionQuery('sessions')).toBe(false)
    expect(isSessionMentionQuery('src/session')).toBe(false)
  })

  it('is recent until a title is typed, and scopes on an exact label', () => {
    expect(parseSessionQuery('session', options)?.phase).toBe('recent')
    expect(parseSessionQuery('session ', options)).toMatchObject({ phase: 'recent', projects: null, titleQuery: '' })
    const scoped = parseSessionQuery('session super-one align popup', options)
    expect(scoped).toMatchObject({ phase: 'search', titleQuery: 'align popup', projectToken: '', scopeNavPrefix: 'session super-one ' })
    expect(scoped?.projects?.map((project) => project.projectKey)).toEqual(['/work/super-one'])
    // The first token is still open, so it is both the title and a completion.
    expect(parseSessionQuery('session sup', options)).toMatchObject({
      phase: 'search', projects: null, projectToken: 'sup', titleQuery: 'sup',
    })
  })
})

describe('project completions', () => {
  it('prefix-matches and puts the current project first', () => {
    expect(sessionProjectItems(options, '', '/work/super-one').map((item) => item.label)).toEqual(['super-one', 'relay'])
    expect(sessionProjectItems(options, 'rel', '/work/super-one').map((item) => item.label)).toEqual(['relay'])
  })

  it('navigates to a scoped query rather than inserting a chip', () => {
    const [current] = sessionProjectItems(options, 'sup', '/work/super-one')
    expect(current).toMatchObject({
      kind: 'session-project', path: 'super-one', navigateTo: 'session super-one ', description: 'current project',
    })
  })
})

describe('session rows', () => {
  const entry = (sessionId: string, title: string, projectName = 'super-one'): SessionListRow => ({
    sessionId, title, projectName, provider: 'claude',
    lastActiveAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  })

  it('shows the title, the project, the age, and what matched inside the title', () => {
    const [row] = sessionItems([entry('sess-1', 'Align the mention popup')], 'align')
    expect(row).toMatchObject({
      kind: 'session', path: 'sess-1', label: 'Align the mention popup', description: 'super-one', badge: '2h',
    })
    expect(row?.labelIndices).toEqual([0, 1, 2, 3, 4])
  })

  it('omits the age when the host did not say when the session was active', () => {
    expect(sessionItems([{ sessionId: 'sess-3', title: 'Ship it' }], '')[0]).not.toHaveProperty('badge')
  })

  it('hides the project once the search is already scoped to it', () => {
    expect(sessionItems([entry('sess-1', 'Align the mention popup')], 'align', false)[0]).not.toHaveProperty('description')
  })

  it('falls back to the id for a session with no title yet', () => {
    expect(sessionItems([entry('sess-2', '')], '')[0]?.label).toBe('sess-2')
  })
})

describe('empty states', () => {
  it('names a recent list and a title search differently', () => {
    expect(sessionEmptyLabel('recent')).toBe('No recent sessions')
    expect(sessionEmptyLabel('search')).toBe('No matching sessions')
  })
})

describe('the portal in the mention list', () => {
  it('is discovered among the capabilities, and navigates instead of inserting', () => {
    const rows = buildMentionRows('sess', { remote: [], agentProfiles: [], capabilityIds: [] })
    const portal = rows.find((row) => row.item.kind === 'session-portal')
    expect(portal?.item.navigateTo).toBe('session ')
    expect(groupMentionRows(rows).find((group) => group.items.includes(portal!))?.key).toBe('capability')
  })

  it('gives completion rows their own group, ahead of the sessions they lead to', () => {
    const rows = buildMentionRows('', {
      remote: [...sessionProjectItems(options, '', null), { kind: 'session', path: 'sess-1', label: 'Ship it' }],
      agentProfiles: [], scoped: true,
    })
    expect(groupMentionRows(rows).map((group) => group.key)).toEqual(['session-project', 'session'])
  })
})
