import { describe, expect, it } from 'vitest'
import {
  initialSessionMentionLoadState, isSessionMentionQuery, loadSessionMentionPage,
  parseSessionQuery, sessionEmptyLabel, sessionItems, sessionProjectItems, sessionProjectOptions,
} from './session-mention'
import { buildMentionRows, groupMentionRows } from './mention-rows'

const projects = [{ path: '/work/super-one', name: 'super-one' }, { path: '/work/relay', name: 'relay' }]
const options = sessionProjectOptions(projects, '/work/super-one')

describe('session mention query', () => {
  it('opens on the portal keyword and nothing else', () => {
    expect(isSessionMentionQuery('session')).toBe(true)
    expect(isSessionMentionQuery('session all fix')).toBe(true)
    expect(isSessionMentionQuery('sessions')).toBe(false)
    expect(isSessionMentionQuery('src/session')).toBe(false)
  })

  it('walks the three phases as the user types', () => {
    expect(parseSessionQuery('session', options, '/work/super-one')?.phase).toBe('pick-project')
    expect(parseSessionQuery('session all ', options, '/work/super-one')?.phase).toBe('need-title')
    const search = parseSessionQuery('session super-one align popup', options, '/work/super-one')
    expect(search?.phase).toBe('search')
    expect(search?.titleQuery).toBe('align popup')
    expect(search?.scope).toEqual({ kind: 'project', projectKey: '/work/super-one', label: 'super-one' })
  })
})

describe('scope choices', () => {
  it('offers every project plus the cross-project scope, current one first', () => {
    const items = sessionProjectItems(options, '', '/work/super-one')
    expect(items.map((item) => item.label)).toEqual(['All Projects', 'super-one', 'relay'])
  })

  it('navigates rather than mentioning, and says where it goes', () => {
    const [all] = sessionProjectItems(options, '', '/work/super-one')
    // `path` is the label, because that is what the row shows and what the
    // match indices were scored over; the token lives in `navigateTo`.
    expect(all).toMatchObject({ path: 'All Projects', navigateTo: 'session all ' })
  })

  it('filters as the scope token is typed', () => {
    expect(sessionProjectItems(options, 'rel', '/work/super-one').map((item) => item.label)).toEqual(['relay'])
  })
})

describe('session rows', () => {
  const entry = (sessionId: string, title: string) => ({
    session: { sessionId, title, lastActiveAt: '', messageCount: 0 },
    projectKey: '/work/super-one',
    projectLabel: 'super-one',
  })

  it('shows the title and highlights what matched inside it', () => {
    const [row] = sessionItems([entry('sess-1', 'Align the mention popup')], 'align')
    expect(row).toMatchObject({ kind: 'session', path: 'sess-1', label: 'Align the mention popup', description: 'super-one' })
    expect(row?.labelIndices).toEqual([0, 1, 2, 3, 4])
  })

  it('falls back to the id for a session with no title yet', () => {
    expect(sessionItems([entry('sess-2', '')], '')[0]?.label).toBe('sess-2')
  })
})

describe('paging', () => {
  const page = (count: number, offset: number) => ({
    sessions: Array.from({ length: count }, (_, index) => ({
      sessionId: `s${offset + index}`, title: `session ${offset + index}`, lastActiveAt: '', messageCount: 0,
    })),
    hasMore: offset + count < 45,
  })

  it('reports more to come, then stops without a short last page', async () => {
    const first = await loadSessionMentionPage({
      scope: { kind: 'project', projectKey: '/work/super-one', label: 'super-one' },
      titleQuery: '', projects: options, state: initialSessionMentionLoadState(),
      loadPage: async (_key, limit, offset) => page(Math.min(limit, 45 - offset), offset),
    })
    expect(first.rows).toHaveLength(30)
    expect(first.next.hasMore).toBe(true)

    const second = await loadSessionMentionPage({
      scope: { kind: 'project', projectKey: '/work/super-one', label: 'super-one' },
      titleQuery: '', projects: options, state: first.next,
      loadPage: async (_key, limit, offset) => page(Math.min(limit, 45 - offset), offset),
    })
    expect(second.rows).toHaveLength(15)
    expect(second.next.hasMore).toBe(false)
  })
})

describe('empty states', () => {
  it('says which question came back empty', () => {
    expect(sessionEmptyLabel('pick-project')).toBe('No matching projects')
    expect(sessionEmptyLabel('need-title')).toBe('No recent sessions')
    expect(sessionEmptyLabel('search')).toBe('No matching sessions')
  })
})

describe('the portal in the mention list', () => {
  it('is discovered among the capabilities, and navigates instead of inserting', () => {
    const rows = buildMentionRows('sess', { remote: [], agentProfiles: [] })
    const portal = rows.find((row) => row.item.kind === 'session-portal')
    expect(portal?.item.navigateTo).toBe('session ')
    expect(groupMentionRows(rows).find((group) => group.items.includes(portal!))?.key).toBe('capability')
  })

  it('gives scope rows their own group, ahead of the sessions they lead to', () => {
    const rows = buildMentionRows('', {
      remote: [...sessionProjectItems(options, '', null), { kind: 'session', path: 'sess-1', label: 'Ship it' }],
      agentProfiles: [], scoped: true,
    })
    expect(groupMentionRows(rows).map((group) => group.key)).toEqual(['session-project', 'session'])
  })
})
