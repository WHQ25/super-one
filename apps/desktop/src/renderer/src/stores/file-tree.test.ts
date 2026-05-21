import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeEntry } from '@superone/shared/agent-types'

const listDirMock = vi.fn<(folder: string, rel: string) => Promise<FileTreeEntry[]>>()
const moveFileMock = vi.fn()
const copyFilesInMock = vi.fn()
const deleteFileMock = vi.fn()
const renameFileMock = vi.fn()

vi.stubGlobal('window', {
  app: {
    listDir: listDirMock,
    moveFile: moveFileMock,
    copyFilesIn: copyFilesInMock,
    deleteFile: deleteFileMock,
    renameFile: renameFileMock,
  },
})

const { useFileTreeStore } = await import('./file-tree')

function makeEntries(names: string[]): FileTreeEntry[] {
  return names.map((name) => ({
    name,
    path: name,
    isDirectory: false,
    gitIndex: null,
    gitWorktree: null,
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
      { name: 'src', path: 'src', isDirectory: true, gitIndex: null, gitWorktree: null },
    ])
    await useFileTreeStore.getState().fetchTree('/projA')

    listDirMock.mockResolvedValueOnce(makeEntries(['index.ts']))
    useFileTreeStore.setState({ expandedDirs: new Set(['src']) })
    await useFileTreeStore.getState().fetchTree('/projB')

    expect(useFileTreeStore.getState().expandedDirs.size).toBe(0)
  })
})

describe('moveFile', () => {
  it('should refresh tree on success', async () => {
    listDirMock.mockResolvedValue(makeEntries(['a.ts']))
    await useFileTreeStore.getState().fetchTree('/proj')
    moveFileMock.mockResolvedValueOnce({ ok: true })
    listDirMock.mockResolvedValueOnce(makeEntries(['a.ts']))

    const result = await useFileTreeStore.getState().moveFile('/proj', 'a.ts', 'src')
    expect(result.ok).toBe(true)
    expect(moveFileMock).toHaveBeenCalledWith('/proj', 'a.ts', 'src')
  })

  it('should not refresh tree on failure', async () => {
    moveFileMock.mockResolvedValueOnce({ ok: false, error: 'fail' })
    const result = await useFileTreeStore.getState().moveFile('/proj', 'a.ts', 'src')
    expect(result.ok).toBe(false)
    expect(listDirMock).not.toHaveBeenCalled()
  })
})

describe('copyFilesIn', () => {
  it('should refresh tree on success', async () => {
    listDirMock.mockResolvedValue(makeEntries(['a.ts']))
    await useFileTreeStore.getState().fetchTree('/proj')
    copyFilesInMock.mockResolvedValueOnce({ ok: true })
    listDirMock.mockResolvedValueOnce(makeEntries(['a.ts', 'b.ts']))

    const result = await useFileTreeStore.getState().copyFilesIn('/proj', '', ['/tmp/b.ts'])
    expect(result.ok).toBe(true)
    expect(copyFilesInMock).toHaveBeenCalledWith('/proj', '', ['/tmp/b.ts'])
  })

  it('should not refresh tree on failure', async () => {
    copyFilesInMock.mockResolvedValueOnce({ ok: false, error: 'fail' })
    const result = await useFileTreeStore.getState().copyFilesIn('/proj', '', ['/tmp/b.ts'])
    expect(result.ok).toBe(false)
  })
})

describe('deleteFile', () => {
  it('should refresh tree on success', async () => {
    listDirMock.mockResolvedValue(makeEntries(['a.ts']))
    await useFileTreeStore.getState().fetchTree('/proj')
    deleteFileMock.mockResolvedValueOnce({ ok: true })
    listDirMock.mockResolvedValueOnce(makeEntries([]))

    const result = await useFileTreeStore.getState().deleteFile('/proj', 'a.ts')
    expect(result.ok).toBe(true)
    expect(deleteFileMock).toHaveBeenCalledWith('/proj', 'a.ts')
  })

  it('should not refresh tree on failure', async () => {
    deleteFileMock.mockResolvedValueOnce({ ok: false, error: 'fail' })
    const result = await useFileTreeStore.getState().deleteFile('/proj', 'a.ts')
    expect(result.ok).toBe(false)
  })
})

describe('revealPath', () => {
  const dir = (path: string): FileTreeEntry => ({
    name: path.split('/').pop()!,
    path,
    isDirectory: true,
    gitIndex: null,
    gitWorktree: null,
  })
  const file = (path: string): FileTreeEntry => ({
    name: path.split('/').pop()!,
    path,
    isDirectory: false,
    gitIndex: null,
    gitWorktree: null,
  })

  it('expands every ancestor directory and marks the target as revealed', async () => {
    listDirMock.mockImplementation(async (_folder, rel) => {
      if (rel === '') return [dir('src')]
      if (rel === 'src') return [dir('src/components')]
      if (rel === 'src/components') return [dir('src/components/sidebar')]
      if (rel === 'src/components/sidebar') return [file('src/components/sidebar/FileTree.tsx')]
      return []
    })
    await useFileTreeStore.getState().fetchTree('/proj')
    await useFileTreeStore.getState().revealPath('/proj', 'src/components/sidebar')

    const { expandedDirs, revealedPath, _visibleList } = useFileTreeStore.getState()
    expect([...expandedDirs].sort()).toEqual(['src', 'src/components', 'src/components/sidebar'])
    expect(revealedPath).toBe('src/components/sidebar')
    const paths = _visibleList.map((v) => v.path)
    expect(paths).toContain('src/components/sidebar')
    expect(paths).toContain('src/components/sidebar/FileTree.tsx')
  })

  it('clearRevealed resets the revealed marker', () => {
    useFileTreeStore.setState({ revealedPath: 'src' })
    useFileTreeStore.getState().clearRevealed()
    expect(useFileTreeStore.getState().revealedPath).toBeNull()
  })
})

describe('renameFile', () => {
  it('should clear renamingPath and refresh on success', async () => {
    listDirMock.mockResolvedValue(makeEntries(['a.ts']))
    await useFileTreeStore.getState().fetchTree('/proj')
    useFileTreeStore.setState({ renamingPath: 'a.ts' })
    renameFileMock.mockResolvedValueOnce({ ok: true })
    listDirMock.mockResolvedValueOnce(makeEntries(['b.ts']))

    const result = await useFileTreeStore.getState().renameFile('/proj', 'a.ts', 'b.ts')
    expect(result.ok).toBe(true)
    expect(useFileTreeStore.getState().renamingPath).toBeNull()
    expect(renameFileMock).toHaveBeenCalledWith('/proj', 'a.ts', 'b.ts')
  })

  it('should keep renamingPath on failure', async () => {
    useFileTreeStore.setState({ renamingPath: 'a.ts' })
    renameFileMock.mockResolvedValueOnce({ ok: false, error: 'fail' })

    const result = await useFileTreeStore.getState().renameFile('/proj', 'a.ts', 'b.ts')
    expect(result.ok).toBe(false)
    expect(useFileTreeStore.getState().renamingPath).toBe('a.ts')
  })
})
