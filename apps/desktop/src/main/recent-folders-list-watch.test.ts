import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))

vi.mock('./database', () => ({ getDb: getDbMock }))
vi.mock('./app-settings-service', () => ({ dropMiniAppOrderBucket: vi.fn() }))
vi.mock('./mcp-apps/resource-store', () => ({ scheduleMcpAppResourceGc: vi.fn() }))

import { addRecentFolder, getRecentFolders, listHiddenProjects, purgeHiddenProjects, removeRecentFolder, updateProject, waitForPendingProjectPurge } from './recent-folders'
import { watchProjectList } from './session-list-watch'

/** `existing` is the one registered project, or none. */
function fakeDb(existing: { id: string; path: string } | null) {
  const row = existing && { ...existing, name: 'repo', added_at: '2026-01-01', extra_dirs_json: null, last_active: '2026-01-01' }
  return {
    prepare: () => ({
      get: () => row ?? undefined,
      all: () => (row ? [row] : []),
      run: () => ({ changes: 1 }),
    }),
  }
}

describe('project list watcher', () => {
  let changes = 0
  let unwatch = () => {}

  beforeEach(() => {
    changes = 0
    unwatch = watchProjectList(() => { changes++ })
  })
  afterEach(async () => {
    unwatch()
    await waitForPendingProjectPurge('/repo')
  })

  it('reports a first registration', () => {
    getDbMock.mockReturnValue(fakeDb(null))
    addRecentFolder('/repo')
    expect(changes).toBe(1)
  })

  it('stays quiet when an already registered folder is reopened', () => {
    getDbMock.mockReturnValue(fakeDb({ id: 'p1', path: '/repo' }))
    addRecentFolder('/repo')
    expect(changes).toBe(0)
  })

  it('reports a removal, but not of a folder that was never registered', () => {
    getDbMock.mockReturnValue(fakeDb({ id: 'p1', path: '/repo' }))
    removeRecentFolder('/repo')
    getDbMock.mockReturnValue(fakeDb(null))
    removeRecentFolder('/unknown')
    expect(changes).toBe(1)
  })

  it('reports a rename, not a folder-only edit', () => {
    getDbMock.mockReturnValue(fakeDb({ id: 'p1', path: '/repo' }))
    updateProject({ projectId: 'p1', extraDirs: ['/shared'] })
    expect(changes).toBe(0)
    updateProject({ projectId: 'p1', name: 'Renamed' })
    expect(changes).toBe(1)
  })

  it('hides project by default without deleting sessions or messages', () => {
    const queries: string[] = []
    const row = { id: 'p1', path: '/repo', name: 'repo', added_at: '2026-01-01', extra_dirs_json: null, last_active: '2026-01-01' }
    getDbMock.mockReturnValue({
      prepare: (sql: string) => ({
        get: () => row,
        all: () => [row],
        run: () => {
          queries.push(sql)
          return { changes: 1 }
        },
      }),
    })

    removeRecentFolder('/repo')
    expect(changes).toBe(1)
    expect(queries.some((sql) => sql.includes('UPDATE projects SET hidden_at'))).toBe(true)
    expect(queries.some((sql) => sql.includes('DELETE FROM'))).toBe(false)
  })

  it('purges removed project asynchronously in batches when deleteData is true', async () => {
    const queries: string[] = []
    let projectDeleted = false
    const row = { id: 'p1', path: '/repo', name: 'repo', added_at: '2026-01-01', extra_dirs_json: null, last_active: '2026-01-01' }
    getDbMock.mockReturnValue({
      prepare: (sql: string) => ({
        get: () => (projectDeleted ? undefined : row),
        all: () => (projectDeleted ? [] : [row]),
        run: () => {
          queries.push(sql)
          if (sql.includes('DELETE FROM projects')) projectDeleted = true
          return { changes: 1 }
        },
      }),
    })

    removeRecentFolder('/repo', { deleteData: true })
    expect(changes).toBe(1)
    expect(getRecentFolders()).toEqual([])
    expect(queries).toEqual([])

    await waitForPendingProjectPurge('/repo')
    expect(queries.some((sql) => sql.includes('DELETE FROM chat_messages'))).toBe(true)
    expect(queries.some((sql) => sql.includes('DELETE FROM sessions'))).toBe(true)
    expect(queries.some((sql) => sql.includes('DELETE FROM projects'))).toBe(true)
  })

  it('lists and purges hidden projects from storage', async () => {
    const queries: string[] = []
    let purged = false
    const hiddenRow = {
      id: 'p2',
      name: 'archived-repo',
      path: '/archived-repo',
      hidden_at: '2026-11-28T00:00:00.000Z',
      session_count: 3,
      message_count: 42,
    }
    getDbMock.mockReturnValue({
      prepare: (sql: string) => ({
        get: () => undefined,
        all: () => (purged ? [] : [hiddenRow]),
        run: () => {
          queries.push(sql)
          if (sql.includes('DELETE FROM projects')) purged = true
          return { changes: 1 }
        },
      }),
    })

    expect(listHiddenProjects()).toEqual([
      {
        id: 'p2',
        name: 'archived-repo',
        path: '/archived-repo',
        hiddenAt: '2026-11-28T00:00:00.000Z',
        sessionCount: 3,
        messageCount: 42,
      },
    ])
    expect(purgeHiddenProjects(['p2'])).toBe(1)
    expect(listHiddenProjects()).toEqual([])
    await waitForPendingProjectPurge('/archived-repo')
    expect(queries.some((sql) => sql.includes('DELETE FROM projects'))).toBe(true)
  })
})
