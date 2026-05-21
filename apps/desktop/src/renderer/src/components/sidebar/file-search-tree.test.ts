import { describe, expect, it } from 'vitest'
import type { FileSearchResult } from '@superone/shared/agent-types'
import { buildSearchTree } from './file-search-tree'

function r(path: string, isDirectory = false, matchIndices: number[] = []): FileSearchResult {
  return { path, isDirectory, matchIndices, score: 1 }
}

describe('buildSearchTree', () => {
  it('synthesizes ancestor directories so a deep match shows in its tree context', () => {
    const flat = buildSearchTree([r('src/components/sidebar/FileTree.tsx')])

    expect(flat.map((n) => `${n.depth}:${n.name}`)).toEqual([
      '0:src',
      '1:components',
      '2:sidebar',
      '3:FileTree.tsx',
    ])
    expect(flat.find((n) => n.name === 'src')!.isDirectory).toBe(true)
    expect(flat.find((n) => n.name === 'FileTree.tsx')!.isDirectory).toBe(false)
  })

  it('merges shared ancestors across multiple matches', () => {
    const flat = buildSearchTree([r('src/b.ts'), r('src/a.ts')])
    expect(flat.map((n) => n.path)).toEqual(['src', 'src/a.ts', 'src/b.ts'])
  })

  it('orders directories before files and sorts alphabetically within a level', () => {
    const flat = buildSearchTree([r('z.ts'), r('a.ts'), r('lib', true)])
    expect(flat.map((n) => n.name)).toEqual(['lib', 'a.ts', 'z.ts'])
  })

  it('distributes full-path match indices onto the owning path segment', () => {
    const flat = buildSearchTree([r('src/app.ts', false, [0, 1, 2, 4, 5])])

    expect(flat.find((n) => n.name === 'src')!.matchIndices).toEqual([0, 1, 2])
    expect(flat.find((n) => n.name === 'app.ts')!.matchIndices).toEqual([0, 1])
  })

  it('keeps highlight on a directory that is itself a match', () => {
    const flat = buildSearchTree([r('src/components', true, [4, 5, 6, 7])])

    const comp = flat.find((n) => n.name === 'components')!
    expect(comp.isDirectory).toBe(true)
    expect(comp.matchIndices).toEqual([0, 1, 2, 3])
  })
})
