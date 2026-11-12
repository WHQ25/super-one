import { describe, expect, it } from 'vitest'
import type { GitStatusFile } from '@superone/shared/agent-types'
import type { FlatNode } from '@/stores/file-tree'
import {
  ancestorFolders,
  buildChangedFileTree,
  scopeSearchResults,
  siblingDirectories,
} from './file-tree-focus'

function dir(path: string, childPaths: string[], isDirectory = true): FlatNode {
  return {
    entry: { name: path.split('/').pop() ?? '', path, isDirectory },
    depth: 0,
    parentPath: '',
    childPaths,
    isLoaded: true,
  }
}

describe('ancestorFolders', () => {
  it('is empty at the project root', () => {
    expect(ancestorFolders('')).toEqual([])
  })

  it('lists the project root and each parent, not the folder itself', () => {
    expect(ancestorFolders('src/components/sidebar')).toEqual(['', 'src', 'src/components'])
  })
})

describe('siblingDirectories', () => {
  it('returns directory children of the parent, including the focused folder', () => {
    const nodes = new Map<string, FlatNode>([
      ['', dir('', ['src', 'docs', 'readme.md'])],
      ['src', dir('src', [])],
      ['docs', dir('docs', [])],
      ['readme.md', dir('readme.md', [], false)],
    ])
    expect(siblingDirectories(nodes, 'src')).toEqual([
      { path: 'src', name: 'src' },
      { path: 'docs', name: 'docs' },
    ])
  })
})

describe('scopeSearchResults', () => {
  it('keeps matches under the folder and shifts highlight indexes', () => {
    const scoped = scopeSearchResults(
      [
        { path: 'src/app.ts', matchIndices: [4, 5] },
        { path: 'docs/guide.md', matchIndices: [0] },
      ],
      'src',
    )
    expect(scoped).toEqual([{ path: 'app.ts', matchIndices: [0, 1] }])
  })
})

describe('buildChangedFileTree', () => {
  const files: GitStatusFile[] = [
    { path: 'src/app.ts', status: 'M', staged: false },
    { path: 'src/components/Button.tsx', status: 'M', staged: true },
    { path: 'docs/guide.md', status: 'A', staged: true },
    { path: 'ignored.log', status: '!', staged: false },
    { path: 'readme.md', status: 'M', staged: false },
  ]

  it('shows changed files and the directories that contain them', () => {
    const rows = buildChangedFileTree(files, '')
    expect(rows.map((row) => `${row.depth}:${row.path}`)).toEqual([
      '0:docs',
      '1:docs/guide.md',
      '0:src',
      '1:src/components',
      '2:src/components/Button.tsx',
      '1:src/app.ts',
      '0:readme.md',
    ])
    expect(rows.find((row) => row.path === 'src/app.ts')).toMatchObject({ gitWorktree: 'M', gitIndex: null })
    expect(rows.find((row) => row.path === 'docs/guide.md')).toMatchObject({ gitIndex: 'A', gitWorktree: null })
    expect(rows.some((row) => row.path === 'ignored.log')).toBe(false)
  })

  it('limits the tree to the focused folder and rebases depth', () => {
    const rows = buildChangedFileTree(files, 'src')
    expect(rows.map((row) => row.path)).toEqual(['src/components', 'src/components/Button.tsx', 'src/app.ts'])
    expect(rows[0]?.depth).toBe(0)
    expect(rows.find((row) => row.path === 'src/app.ts')?.depth).toBe(0)
    expect(rows.find((row) => row.path === 'src/components/Button.tsx')?.depth).toBe(1)
  })
})
