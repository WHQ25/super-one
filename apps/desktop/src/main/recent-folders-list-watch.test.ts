import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))

vi.mock('./database', () => ({ getDb: getDbMock }))
vi.mock('./app-settings-service', () => ({ dropMiniAppOrderBucket: vi.fn() }))
vi.mock('./mcp-apps/resource-store', () => ({ scheduleMcpAppResourceGc: vi.fn() }))

import { addRecentFolder, removeRecentFolder, updateProject } from './recent-folders'
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
  afterEach(() => { unwatch() })

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
})
