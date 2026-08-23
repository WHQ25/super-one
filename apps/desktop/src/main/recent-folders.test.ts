import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))

vi.mock('./database', () => ({ getDb: getDbMock }))
vi.mock('./app-settings-service', () => ({ dropMiniAppOrderBucket: vi.fn() }))

import { addRecentFolder, getProjectExtraDirs, getRecentFolders, updateProject } from './recent-folders'

interface ProjectRow {
  id: string
  path: string
  name: string
  added_at: string
  extra_dirs_json: string | null
  is_user_renamed: number
}

/**
 * Stand-in for the `projects` table.
 *
 * The suite cannot load a real better-sqlite3 (native module), so the fake
 * interprets just enough SQL to exercise the upsert's conflict clause — which
 * is the part that actually decides whether a rename survives.
 */
function createMockDb(seed: ProjectRow[] = []) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]))
  const byPath = (path: string) => [...rows.values()].find((r) => r.path === path)

  return {
    rows,
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT INTO projects')) {
          const [id, path, name, addedAt] = args as string[]
          const existing = byPath(path)
          if (!existing) {
            rows.set(id, { id, path, name, added_at: addedAt, extra_dirs_json: '[]', is_user_renamed: 0 })
            return
          }
          // ON CONFLICT(path) DO UPDATE SET name = CASE WHEN is_user_renamed …
          if (existing.is_user_renamed !== 1) existing.name = name
          return
        }
        if (sql.includes('UPDATE projects')) {
          const [nextName, renamedFlag, nextExtraDirs, id] = args as Array<string | number | null>
          const target = rows.get(id as string)
          if (!target) return
          if (nextName != null) target.name = nextName as string
          if (renamedFlag != null) target.is_user_renamed = renamedFlag as number
          if (nextExtraDirs != null) target.extra_dirs_json = nextExtraDirs as string
        }
      }),
      get: vi.fn((arg: string) => {
        if (sql.includes('WHERE id = ?')) return rows.get(arg)
        if (sql.includes('WHERE path = ?')) return byPath(arg)
        return undefined
      }),
      all: vi.fn(() =>
        [...rows.values()].map((r) => ({ ...r, last_active: r.added_at })),
      ),
    })),
  }
}

const SEED: ProjectRow = {
  id: 'p1',
  path: '/repo/apps/desktop',
  name: 'desktop',
  added_at: '2026-01-01T00:00:00.000Z',
  extra_dirs_json: '[]',
  is_user_renamed: 0,
}

describe('project name across re-opens', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps a custom name when the same folder is opened again', () => {
    const db = createMockDb([SEED])
    getDbMock.mockReturnValue(db)

    updateProject({ projectId: 'p1', name: 'Desktop App' })
    // openFolder runs addRecentFolder on every open — this is the regression.
    addRecentFolder('/repo/apps/desktop')

    expect(getRecentFolders()[0].name).toBe('Desktop App')
  })

  it('still tracks the folder basename for a project the user never renamed', () => {
    const db = createMockDb([{ ...SEED, path: '/repo/apps/old-name', name: 'old-name' }])
    getDbMock.mockReturnValue(db)

    addRecentFolder('/repo/apps/old-name')

    expect(getRecentFolders()[0].name).toBe('old-name')
  })

  it('keeps tracking the folder name when a folders-only save resubmits it unchanged', () => {
    // The dialog always sends `name`, so keying the pin off "a name was
    // supplied" would freeze the label after any Edit Project save.
    const db = createMockDb([SEED])
    getDbMock.mockReturnValue(db)

    updateProject({ projectId: 'p1', name: 'desktop', extraDirs: ['/repo/packages/ui'] })
    addRecentFolder('/repo/apps/desktop')

    expect(db.rows.get('p1')?.is_user_renamed).toBe(0)
  })

  it('unpins the name when the user renames it back to the folder name', () => {
    const db = createMockDb([{ ...SEED, name: 'Custom', is_user_renamed: 1 }])
    getDbMock.mockReturnValue(db)

    updateProject({ projectId: 'p1', name: 'desktop' })

    expect(db.rows.get('p1')?.is_user_renamed).toBe(0)
  })

  it('rejects an empty name rather than leaving the sidebar row blank', () => {
    getDbMock.mockReturnValue(createMockDb([SEED]))
    expect(() => updateProject({ projectId: 'p1', name: '   ' })).toThrow(/empty/)
  })

  it('reports not_found for a project id that is no longer registered', () => {
    getDbMock.mockReturnValue(createMockDb([SEED]))
    expect(() => updateProject({ projectId: 'gone', name: 'x' })).toThrow(/not found/)
  })
})

describe('project workspace folders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('round-trips a folder list and exposes it on the recent-folders row', () => {
    getDbMock.mockReturnValue(createMockDb([SEED]))

    updateProject({ projectId: 'p1', extraDirs: ['/repo/packages/ui'] })

    expect(getRecentFolders()[0].extraDirs).toEqual(['/repo/packages/ui'])
    expect(getProjectExtraDirs('/repo/apps/desktop')).toEqual(['/repo/packages/ui'])
  })

  it('reads an empty list for a row written before the column existed', () => {
    getDbMock.mockReturnValue(createMockDb([{ ...SEED, extra_dirs_json: null }]))
    expect(getRecentFolders()[0].extraDirs).toEqual([])
    expect(getProjectExtraDirs('/repo/apps/desktop')).toEqual([])
  })

  it('leaves folders untouched when only the name is edited', () => {
    getDbMock.mockReturnValue(createMockDb([{ ...SEED, extra_dirs_json: '["/repo/packages/ui"]' }]))

    updateProject({ projectId: 'p1', name: 'Renamed' })

    const [folder] = getRecentFolders()
    expect(folder.name).toBe('Renamed')
    expect(folder.extraDirs).toEqual(['/repo/packages/ui'])
  })

  it('leaves the name untouched when only folders are edited', () => {
    getDbMock.mockReturnValue(createMockDb([{ ...SEED, name: 'Custom', is_user_renamed: 1 }]))

    updateProject({ projectId: 'p1', extraDirs: ['/elsewhere'] })

    const [folder] = getRecentFolders()
    expect(folder.name).toBe('Custom')
    expect(folder.extraDirs).toEqual(['/elsewhere'])
  })

  it('resolves a project by path when no id is supplied', () => {
    getDbMock.mockReturnValue(createMockDb([SEED]))

    updateProject({ path: '/repo/apps/desktop', extraDirs: ['/elsewhere'] })

    expect(getRecentFolders()[0].extraDirs).toEqual(['/elsewhere'])
  })

  it('appends an add-dir delta to whatever is already stored', () => {
    getDbMock.mockReturnValue(createMockDb([{ ...SEED, extra_dirs_json: '["/repo/packages/ui"]' }]))

    // A second window that only knows about its own folder must not delete the
    // first window's — which is exactly what sending the whole array would do.
    updateProject({ projectId: 'p1', addExtraDirs: ['/repo/packages/shared'] })

    expect(getRecentFolders()[0].extraDirs).toEqual([
      '/repo/packages/ui', '/repo/packages/shared',
    ])
  })

  it('drops only the named folder for a remove delta', () => {
    getDbMock.mockReturnValue(createMockDb([{ ...SEED, extra_dirs_json: '["/a","/b"]' }]))

    updateProject({ projectId: 'p1', removeExtraDirs: ['/a'] })

    expect(getRecentFolders()[0].extraDirs).toEqual(['/b'])
  })

  it("lets Edit Project's whole-array save win over what is stored", () => {
    getDbMock.mockReturnValue(createMockDb([{ ...SEED, extra_dirs_json: '["/a","/b"]' }]))

    // A Save button promises last-writer-wins; only `/add-dir` is a delta.
    updateProject({ projectId: 'p1', extraDirs: ['/c'] })

    expect(getRecentFolders()[0].extraDirs).toEqual(['/c'])
  })
})
