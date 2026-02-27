import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeEntry } from '../../../shared/agent-types'

const listDirMock = vi.fn<(folder: string, rel: string) => Promise<FileTreeEntry[]>>()

vi.stubGlobal('window', {
  app: { listDir: listDirMock },
})

const { useFileTreeStore } = await import('./file-tree')

function makeEntries(names: string[]): FileTreeEntry[] {
  return names.map((name) => ({
    name,
    path: name,
    isDirectory: false,
    gitStatus: null,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  useFileTreeStore.getState().reset()
})

describe('fetchTree', () => {
  it('should replace previous project data without external reset', async () => {
    listDirMock.mockResolvedValueOnce(makeEntries(['old.ts']))
    await useFileTreeStore.getState().fetchTree('/projA')
    expect(useFileTreeStore.getState()._visibleList).toHaveLength(1)
    expect(useFileTreeStore.getState()._visibleList[0].name).toBe('old.ts')

    listDirMock.mockResolvedValueOnce(makeEntries(['new1.ts', 'new2.ts']))
    await useFileTreeStore.getState().fetchTree('/projB')
    expect(useFileTreeStore.getState()._visibleList).toHaveLength(2)
    expect(useFileTreeStore.getState()._visibleList.map((i) => i.name)).toEqual(['new1.ts', 'new2.ts'])
  })

  it('should clear data on failure', async () => {
    listDirMock.mockResolvedValueOnce(makeEntries(['file.ts']))
    await useFileTreeStore.getState().fetchTree('/proj')
    expect(useFileTreeStore.getState()._visibleList).toHaveLength(1)

    listDirMock.mockRejectedValueOnce(new Error('fail'))
    await useFileTreeStore.getState().fetchTree('/bad')
    expect(useFileTreeStore.getState()._visibleList).toHaveLength(0)
    expect(useFileTreeStore.getState().loading).toBe(false)
  })

  it('should not be affected by a late-arriving reset', async () => {
    listDirMock.mockResolvedValueOnce(makeEntries(['a.ts', 'b.ts']))
    await useFileTreeStore.getState().fetchTree('/proj')

    useFileTreeStore.getState().reset()
    expect(useFileTreeStore.getState()._visibleList).toHaveLength(0)

    listDirMock.mockResolvedValueOnce(makeEntries(['c.ts']))
    await useFileTreeStore.getState().fetchTree('/proj2')
    expect(useFileTreeStore.getState()._visibleList).toHaveLength(1)
    expect(useFileTreeStore.getState()._visibleList[0].name).toBe('c.ts')
  })

  it('should reset expandedDirs when switching projects', async () => {
    listDirMock.mockResolvedValueOnce([
      { name: 'src', path: 'src', isDirectory: true, gitStatus: null },
    ])
    await useFileTreeStore.getState().fetchTree('/projA')

    listDirMock.mockResolvedValueOnce(makeEntries(['index.ts']))
    useFileTreeStore.setState({ expandedDirs: new Set(['src']) })
    await useFileTreeStore.getState().fetchTree('/projB')

    expect(useFileTreeStore.getState().expandedDirs.size).toBe(0)
  })
})
