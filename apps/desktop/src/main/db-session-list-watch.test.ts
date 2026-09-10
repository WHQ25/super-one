import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, getProjectIdMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getProjectIdMock: vi.fn(),
}))

vi.mock('./database', () => ({ getDb: getDbMock }))
vi.mock('./recent-folders', () => ({ getProjectId: getProjectIdMock }))
vi.mock('./logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  createSession,
  deleteSession,
  deleteSessionsOlderThan,
  hideSession,
  pinSession,
  renameSession,
} from './db-sessions'
import { watchSessionList } from './session-list-watch'

/**
 * A session row's project is resolved by joining `projects`; every other
 * statement is a write whose result nothing here reads.
 */
function fakeDb(options: { projectPathOfSession?: string | null; olderThanIds?: string[] } = {}) {
  return {
    prepare: (sql: string) => ({
      get: () => (options.projectPathOfSession === undefined
        ? { path: '/repo' }
        : options.projectPathOfSession === null ? undefined : { path: options.projectPathOfSession }),
      all: () => (sql.includes('is_pinned') ? (options.olderThanIds ?? []).map((id) => ({ id })) : []),
      run: () => ({ changes: 1 }),
    }),
  }
}

describe('session list watchers', () => {
  const changed: string[] = []
  let unwatch = () => {}

  beforeEach(() => {
    changed.length = 0
    getDbMock.mockReset()
    getProjectIdMock.mockReset()
    getProjectIdMock.mockReturnValue('project-1')
    getDbMock.mockReturnValue(fakeDb())
    unwatch = watchSessionList((projectPath) => { changed.push(projectPath) })
  })
  afterEach(() => { unwatch() })

  it('reports the project a new session landed in', () => {
    createSession('/repo', 'session-1')
    expect(changed).toEqual(['/repo'])
  })

  it('resolves the project of a session identified only by id', () => {
    getDbMock.mockReturnValue(fakeDb({ projectPathOfSession: '/other-repo' }))
    pinSession('session-1', true)
    expect(changed).toEqual(['/other-repo'])
  })

  it.each([
    ['rename', () => renameSession('session-1', 'New title')],
    ['hide', () => hideSession('session-1', true)],
    ['unpin', () => pinSession('session-1', false)],
    // The delete has to resolve the project before the row it joins through is gone.
    ['delete', () => deleteSession('session-1')],
  ])('reports a %s', (_label, mutate) => {
    mutate()
    expect(changed).toEqual(['/repo'])
  })

  it('reports a bulk cleanup once, for the folder it swept', () => {
    getDbMock.mockReturnValue(fakeDb({ olderThanIds: ['a', 'b', 'c'] }))
    deleteSessionsOlderThan('/repo', '2026-01-01')
    expect(changed).toEqual(['/repo'])
  })

  it('stays quiet when a cleanup matched nothing', () => {
    getDbMock.mockReturnValue(fakeDb({ olderThanIds: [] }))
    deleteSessionsOlderThan('/repo', '2026-01-01')
    expect(changed).toEqual([])
  })

  it('says nothing about a session whose project cannot be resolved', () => {
    getDbMock.mockReturnValue(fakeDb({ projectPathOfSession: null }))
    hideSession('ghost', true)
    expect(changed).toEqual([])
  })

  it('stops reporting once unwatched', () => {
    unwatch()
    createSession('/repo', 'session-1')
    expect(changed).toEqual([])
  })
})
