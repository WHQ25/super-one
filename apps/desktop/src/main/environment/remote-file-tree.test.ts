import { describe, expect, it, vi } from 'vitest'
import {
  hostPathsEqual,
  listRemoteFileTreeDir,
  mapWorkspaceEntriesToFileTree,
  moveRemoteFile,
  normalizeHostPath,
  relativePathUnderRemoteProject,
  renameRemoteFile,
  deleteRemoteFile,
  copyLocalPathsIntoRemote,
  movePathsIntoRemote,
  readRemoteProjectFile,
  saveRemoteProjectFile,
  getRemoteGitInfo,
  getRemoteGitIsRepo,
  getRemoteGitBranches,
  getRemoteWorktreeInfo,
} from './remote-file-tree'
import type { WorkspaceEntry } from '@superone/shared/environment'
import type { EnvironmentHost } from './environment-host'
import { parseGitStatusOutput } from '../git-status-utils'

describe('normalizeHostPath / hostPathsEqual', () => {
  it('strips trailing slashes and unifies separators', () => {
    expect(normalizeHostPath('/work/app/')).toBe('/work/app')
    expect(hostPathsEqual('/work/app', '/work/app/')).toBe(true)
    expect(hostPathsEqual('/work/app', '/work/other')).toBe(false)
  })
})

describe('mapWorkspaceEntriesToFileTree', () => {
  it('maps types, skips noise, sorts dirs first', () => {
    const entries: WorkspaceEntry[] = [
      { name: 'z.txt', path: 'z.txt', type: 'file' },
      { name: 'src', path: 'src', type: 'directory' },
      { name: '.git', path: '.git', type: 'directory' },
      { name: '.DS_Store', path: '.DS_Store', type: 'file' },
      { name: 'a.ts', path: 'a.ts', type: 'file' },
    ]
    const tree = mapWorkspaceEntriesToFileTree(entries)
    expect(tree.map((e) => e.name)).toEqual(['src', 'a.ts', 'z.txt'])
    expect(tree[0]).toMatchObject({
      name: 'src',
      path: 'src',
      isDirectory: true,
      gitIndex: null,
      gitWorktree: null,
    })
    expect(tree[1]?.isDirectory).toBe(false)
  })

  it('keeps nested relative paths from the project root', () => {
    const tree = mapWorkspaceEntriesToFileTree([
      { name: 'foo.ts', path: 'src/foo.ts', type: 'file' },
    ])
    expect(tree[0]?.path).toBe('src/foo.ts')
  })

  it('applies git status decorations when porcelain is provided', () => {
    const parsed = parseGitStatusOutput(' M a.ts\n?? b.ts\n')
    const tree = mapWorkspaceEntriesToFileTree(
      [
        { name: 'a.ts', path: 'a.ts', type: 'file' },
        { name: 'b.ts', path: 'b.ts', type: 'file' },
        { name: 'c.ts', path: 'c.ts', type: 'file' },
      ],
      parsed,
    )
    expect(tree.find((e) => e.name === 'a.ts')).toMatchObject({ gitWorktree: 'M' })
    expect(tree.find((e) => e.name === 'b.ts')).toMatchObject({ gitWorktree: '?' })
    expect(tree.find((e) => e.name === 'c.ts')).toMatchObject({
      gitIndex: null,
      gitWorktree: null,
    })
  })
})

function mockHost(overrides: Record<string, unknown> = {}): EnvironmentHost {
  return {
    connections: {
      listKnown: () => [{ connectionId: 'conn-1', environmentId: 'env-1' }],
    },
    listProjects: vi.fn().mockResolvedValue([
      { projectId: 'proj-1', path: '/work/app', name: 'app' },
    ]),
    openProject: vi.fn(),
    getGateway: vi.fn().mockReturnValue(null),
    workspace: () => ({
      listDir: vi.fn().mockResolvedValue([]),
      rename: vi.fn().mockResolvedValue({ from: 'a.ts', to: 'b.ts' }),
      move: vi.fn().mockResolvedValue({ from: 'a.ts', to: 'src/a.ts' }),
      delete: vi.fn().mockResolvedValue({ path: 'a.ts' }),
    }),
    ...overrides,
  } as unknown as EnvironmentHost
}

describe('listRemoteFileTreeDir', () => {
  it('returns null for local paths', async () => {
    expect(await listRemoteFileTreeDir(mockHost(), '/Users/me/app', '')).toBeNull()
  })

  it('lists via workspace RPC for remote project keys', async () => {
    const listDir = vi.fn().mockResolvedValue([
      { name: 'README.md', path: 'README.md', type: 'file' },
      { name: 'src', path: 'src', type: 'directory' },
    ] satisfies WorkspaceEntry[])
    const host = mockHost({
      workspace: () => ({ listDir }),
    })

    const tree = await listRemoteFileTreeDir(host, 'remote:conn-1:/work/app', '')
    expect(tree?.map((e) => e.name)).toEqual(['src', 'README.md'])
    expect(listDir).toHaveBeenCalledWith({
      project: { environmentId: 'env-1', projectId: 'proj-1' },
      relativePath: '.',
    })
  })
})

describe('remote file mutations', () => {
  it('rename / move / delete call workspace RPC', async () => {
    const rename = vi.fn().mockResolvedValue({ from: 'a.ts', to: 'b.ts' })
    const move = vi.fn().mockResolvedValue({ from: 'a.ts', to: 'src/a.ts' })
    const del = vi.fn().mockResolvedValue({ path: 'a.ts' })
    const host = mockHost({
      workspace: () => ({ rename, move, delete: del }),
    })

    expect(await renameRemoteFile(host, 'remote:conn-1:/work/app', 'a.ts', 'b.ts')).toEqual({
      ok: true,
    })
    expect(rename).toHaveBeenCalledWith({
      project: { environmentId: 'env-1', projectId: 'proj-1' },
      relativePath: 'a.ts',
      newName: 'b.ts',
    })

    expect(await moveRemoteFile(host, 'remote:conn-1:/work/app', 'a.ts', 'src')).toEqual({
      ok: true,
    })
    expect(move).toHaveBeenCalledWith({
      project: { environmentId: 'env-1', projectId: 'proj-1' },
      fromPath: 'a.ts',
      destDirPath: 'src',
    })

    expect(await deleteRemoteFile(host, 'remote:conn-1:/work/app', 'a.ts')).toEqual({ ok: true })
    expect(del).toHaveBeenCalledWith({
      project: { environmentId: 'env-1', projectId: 'proj-1' },
      relativePath: 'a.ts',
    })
  })

  it('returns null for local paths so IPC can use disk APIs', async () => {
    const host = mockHost()
    expect(await renameRemoteFile(host, '/local/app', 'a.ts', 'b.ts')).toBeNull()
    expect(await moveRemoteFile(host, '/local/app', 'a.ts', 'src')).toBeNull()
    expect(await deleteRemoteFile(host, '/local/app', 'a.ts')).toBeNull()
  })
})

describe('relativePathUnderRemoteProject', () => {
  const folder = 'remote:conn-1:/work/app'

  it('extracts rel path from remote keys', () => {
    expect(relativePathUnderRemoteProject(folder, 'remote:conn-1:/work/app/src/a.ts')).toBe(
      'src/a.ts',
    )
  })

  it('extracts rel path from folderPath-joined drag paths', () => {
    expect(relativePathUnderRemoteProject(folder, 'remote:conn-1:/work/app/src/a.ts')).toBe(
      'src/a.ts',
    )
    expect(relativePathUnderRemoteProject(folder, `${folder}/src/a.ts`)).toBe('src/a.ts')
  })

  it('rejects foreign connections and local paths', () => {
    expect(relativePathUnderRemoteProject(folder, 'remote:other:/work/app/a.ts')).toBeNull()
    expect(relativePathUnderRemoteProject(folder, '/work/app/a.ts')).toBeNull()
  })
})

describe('movePathsIntoRemote', () => {
  it('moves same-project remote paths via workspace.move', async () => {
    const move = vi.fn().mockResolvedValue({ from: 'a.ts', to: 'src/a.ts' })
    const host = mockHost({
      workspace: () => ({ move }),
    })
    const result = await movePathsIntoRemote(host, 'remote:conn-1:/work/app', 'src', [
      'remote:conn-1:/work/app/a.ts',
    ])
    expect(result).toEqual({ ok: true })
    expect(move).toHaveBeenCalledWith({
      project: { environmentId: 'env-1', projectId: 'proj-1' },
      fromPath: 'a.ts',
      destDirPath: 'src',
    })
  })
})

describe('copyLocalPathsIntoRemote', () => {
  it('returns null for local project roots', async () => {
    expect(await copyLocalPathsIntoRemote(mockHost(), '/local/app', '', ['/tmp/x'])).toBeNull()
  })
})

describe('getRemoteGitInfo / isRepo / branches', () => {
  it('maps node git.status into status-bar GitInfo', async () => {
    const gitStatus = vi.fn().mockResolvedValue({
      isRepo: true,
      branch: 'main',
      dirty: true,
      porcelain: ' M a.ts\n?? b.ts\n',
      insertions: 12,
      deletions: 3,
    })
    const host = mockHost({
      getGateway: () => ({ gitStatus }),
    })
    const info = await getRemoteGitInfo(host, 'remote:conn-1:/work/app')
    expect(info).toEqual({
      branch: 'main',
      dirty: { files: 2, insertions: 12, deletions: 3 },
    })
    expect(await getRemoteGitIsRepo(host, 'remote:conn-1:/work/app')).toBe(true)
  })

  it('lists remote branches', async () => {
    const gitStatus = vi.fn().mockResolvedValue({ isRepo: true, branch: 'main', porcelain: '' })
    const gitBranches = vi.fn().mockResolvedValue({
      current: 'main',
      branches: ['main', 'feat'],
    })
    const host = mockHost({
      getGateway: () => ({ gitStatus, gitBranches }),
    })
    expect(await getRemoteGitBranches(host, 'remote:conn-1:/work/app')).toEqual(['main', 'feat'])
  })

  it('returns null for local paths', async () => {
    expect(await getRemoteGitInfo(mockHost(), '/local/app')).toBeNull()
    expect(await getRemoteGitIsRepo(mockHost(), '/local/app')).toBeNull()
  })
})

describe('getRemoteWorktreeInfo', () => {
  it('synthesizes a main worktree entry so WorkDirIndicator can show Local', async () => {
    const gitStatus = vi.fn().mockResolvedValue({
      isRepo: true,
      branch: 'main',
      porcelain: '',
    })
    const gitWorktrees = vi.fn().mockResolvedValue([
      { path: '/work/app', branch: 'main', bare: false },
    ])
    const host = mockHost({
      getGateway: () => ({ gitStatus, gitWorktrees }),
    })
    const info = await getRemoteWorktreeInfo(host, 'remote:conn-1:/work/app')
    expect(info).toMatchObject({
      isWorktree: false,
      currentBranch: 'main',
    })
    expect(info?.entries).toEqual([
      {
        path: '/work/app',
        branch: 'main',
        head: '',
        isMain: true,
        isCurrent: true,
      },
    ])
  })

  it('returns null when not a git repo', async () => {
    const gitStatus = vi.fn().mockResolvedValue({ isRepo: false })
    const host = mockHost({
      getGateway: () => ({ gitStatus }),
    })
    expect(await getRemoteWorktreeInfo(host, 'remote:conn-1:/work/app')).toBeNull()
  })
})

describe('readRemoteProjectFile / saveRemoteProjectFile', () => {
  it('reads text via workspace.readFile', async () => {
    const readFile = vi.fn().mockResolvedValue({
      content: Buffer.from('export const x = 1\n'),
    })
    const host = mockHost({
      workspace: () => ({ readFile }),
    })
    const result = await readRemoteProjectFile(host, 'remote:conn-1:/work/app', 'src/a.ts')
    expect(result).toMatchObject({
      path: 'src/a.ts',
      content: 'export const x = 1\n',
      language: 'typescript',
    })
    expect(readFile).toHaveBeenCalledWith({
      project: { environmentId: 'env-1', projectId: 'proj-1' },
      relativePath: 'src/a.ts',
    })
  })

  it('returns image data URI for png', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
    const readFile = vi.fn().mockResolvedValue({ content: png })
    const host = mockHost({
      workspace: () => ({ readFile }),
    })
    const result = await readRemoteProjectFile(host, 'remote:conn-1:/work/app', 'pic.png')
    expect(result?.language).toBe('image')
    expect(result?.content.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('saves text via workspace.writeFile', async () => {
    const writeFile = vi.fn().mockResolvedValue({ hash: 'abc' })
    const host = mockHost({
      workspace: () => ({ writeFile }),
    })
    expect(
      await saveRemoteProjectFile(host, 'remote:conn-1:/work/app', 'a.ts', 'hello'),
    ).toEqual({ ok: true })
    expect(writeFile).toHaveBeenCalledWith({
      project: { environmentId: 'env-1', projectId: 'proj-1' },
      relativePath: 'a.ts',
      content: 'hello',
    })
  })
})
