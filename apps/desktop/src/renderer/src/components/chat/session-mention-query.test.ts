import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import {
  SESSION_MENTION_ARGUMENT_HINT,
  hostLocalProjectPaths,
  parseSessionMentionQuery,
  remainingSessionArgumentHint,
  searchSessionMentions,
  sessionProjectsOnHost,
} from './session-mention-query'

const searchSessionsByTitle = vi.fn()

vi.stubGlobal('window', {
  environment: { searchSessionsByTitle },
})

const row = (sessionId: string, folderName: string, folderPath: string): PinnedSessionEntry => ({
  sessionId,
  title: sessionId,
  lastActiveAt: '1',
  messageCount: 1,
  folderName,
  folderPath,
})

describe('session grammar re-export', () => {
  const projects = [{ projectKey: '/Users/me/super-one', label: 'super-one' }]

  it('keeps the optional project hint and scopes on an exact label', () => {
    expect(SESSION_MENTION_ARGUMENT_HINT).toBe('[project] <title>')
    expect(remainingSessionArgumentHint('session', projects)).toBe('[project] <title>')
    expect(remainingSessionArgumentHint('session super-one ', projects)).toBe('<title>')
    expect(parseSessionMentionQuery('session fix login', { projects })).toMatchObject({
      phase: 'search',
      projects: null,
      titleQuery: 'fix login',
    })
  })
})

describe('same-host project options', () => {
  const folders = [
    { path: '/Users/me/super-one', name: 'super-one' },
    { path: 'remote:c1:/work/api', name: 'api' },
  ]

  it('keeps only projects on the active host', () => {
    expect(sessionProjectsOnHost(folders, '/Users/me/super-one').map((project) => project.label)).toEqual(['super-one'])
    expect(sessionProjectsOnHost(folders, 'remote:c1:/work/api').map((project) => project.label)).toEqual(['api'])
  })

  it('strips the remote key before the host sees a path', () => {
    expect(hostLocalProjectPaths([
      { projectKey: '/work/a', label: 'a' },
      { projectKey: 'remote:c1:/work/b', label: 'b' },
    ])).toEqual(['/work/a', '/work/b'])
  })
})

describe('searchSessionMentions', () => {
  beforeEach(() => {
    searchSessionsByTitle.mockReset()
  })

  it('asks the local host and keeps its order and project label', async () => {
    searchSessionsByTitle.mockResolvedValueOnce([
      row('newer', 'relay', '/work/relay'),
      row('older', 'super-one', '/work/super-one'),
    ])
    const rows = await searchSessionMentions('', 'auth', 3)
    expect(searchSessionsByTitle).toHaveBeenCalledWith('local', 'auth', 3, undefined)
    expect(rows.map((entry) => entry.sessionId)).toEqual(['newer', 'older'])
    expect(rows[0]?.folderName).toBe('relay')
  })

  it('routes a remote project key to that connection and forwards scoped paths', async () => {
    searchSessionsByTitle.mockResolvedValueOnce([])
    await searchSessionMentions('remote:c1:/work', 'popup', 50, ['/work'])
    expect(searchSessionsByTitle).toHaveBeenCalledWith('c1', 'popup', 50, ['/work'])
    await searchSessionMentions('/Users/me/super-one', 'popup')
    expect(searchSessionsByTitle).toHaveBeenLastCalledWith('local', 'popup', undefined, undefined)
  })

  it('treats a non-array answer as no rows', async () => {
    searchSessionsByTitle.mockResolvedValueOnce(undefined)
    await expect(searchSessionMentions('/Users/me/super-one', 'popup')).resolves.toEqual([])
  })
})
