import { describe, it, expect } from 'vitest'
import { fuzzyMatch } from './fuzzy-match'
import {
  ensureBrowseDirectoryPath,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  getPathInlineGhost,
  getPathInlineGhostSuffix,
  isBareHomePath,
  isBrowseablePathQuery,
  normalizeHomePrefixInput,
} from './path-browse'

describe('bare home path (~)', () => {
  it('is a browseable complete directory, not a leaf named "~"', () => {
    expect(isBrowseablePathQuery('~')).toBe(true)
    expect(isBareHomePath('~')).toBe(true)
    expect(getBrowseDirectoryPath('~')).toBe('~/')
    expect(getBrowseLeafPathSegment('~')).toBe('')
    expect(ensureBrowseDirectoryPath('~')).toBe('~/')
    expect(getBrowseParentPath('~')).toBeNull()
    expect(getBrowseParentPath('~/')).toBeNull()
  })

  it('still treats ~/prefix as a normal path with a leaf', () => {
    expect(getBrowseDirectoryPath('~/Projects')).toBe('~/')
    expect(getBrowseLeafPathSegment('~/Projects')).toBe('Projects')
    expect(getBrowseDirectoryPath('~/Projects/')).toBe('~/Projects/')
    expect(getBrowseLeafPathSegment('~/Projects/')).toBe('')
  })

  it('accepts a Windows-style ~\\ prefix as browseable', () => {
    expect(isBrowseablePathQuery('~\\Projects')).toBe(true)
    expect(getBrowseDirectoryPath('~\\Projects')).toBe('~\\')
    expect(getBrowseLeafPathSegment('~\\Projects')).toBe('Projects')
  })

  it('expands a just-typed ~ to ~/ without trapping a backspace', () => {
    expect(normalizeHomePrefixInput('', '~')).toBe('~/')
    expect(normalizeHomePrefixInput('local', '~')).toBe('~/')
    // Deleting the trailing slash of ~/ must not re-insert it.
    expect(normalizeHomePrefixInput('~/', '~')).toBe('~')
    expect(normalizeHomePrefixInput('~\\', '~')).toBe('~')
    expect(normalizeHomePrefixInput('~/Projects', '~/Projects/x')).toBe('~/Projects/x')
  })
})

describe('getPathInlineGhost', () => {
  it('uses suffix mode for a prefix match', () => {
    expect(getPathInlineGhost('~/Deve', 'Developer')).toEqual({
      kind: 'suffix',
      text: 'loper',
    })
    expect(getPathInlineGhost('~/Dev/no', 'notes')).toEqual({
      kind: 'suffix',
      text: 'tes',
    })
  })

  it('keeps the candidate casing for the suffix remainder', () => {
    expect(getPathInlineGhost('~/deve', 'Developer')).toEqual({
      kind: 'suffix',
      text: 'loper',
    })
  })

  it('offers a trailing separator when the leaf already matches exactly', () => {
    expect(getPathInlineGhost('~/Developer', 'Developer')).toEqual({
      kind: 'suffix',
      text: '/',
    })
    expect(getPathInlineGhost('C:\\Dev\\Notes', 'Notes')).toEqual({
      kind: 'suffix',
      text: '\\',
    })
  })

  it('ghosts the full child name at a directory boundary', () => {
    expect(getPathInlineGhost('~/', 'Developer')).toEqual({
      kind: 'suffix',
      text: 'Developer/',
    })
    expect(getPathInlineGhost('~/Projects/', 'super-one')).toEqual({
      kind: 'suffix',
      text: 'super-one/',
    })
  })

  it('uses fuzzy mode when the leaf is a non-prefix fuzzy match', () => {
    const { indices, match } = fuzzyMatch('Dvl', 'Developer')
    expect(match).toBe(true)
    expect(getPathInlineGhost('~/Dvl', 'Developer', indices)).toEqual({
      kind: 'fuzzy',
      dir: '~/',
      name: 'Developer',
      matchIndices: indices,
      sep: '/',
    })
  })

  it('returns null without a prefix or fuzzy match', () => {
    expect(getPathInlineGhost('~/xyz', 'Developer')).toBeNull()
    expect(getPathInlineGhost('~/xyz', 'Developer', [])).toBeNull()
    expect(getPathInlineGhost('~/Deve', null)).toBeNull()
    expect(getPathInlineGhost('~/Deve', '')).toBeNull()
  })

  it('keeps the legacy suffix helper for prefix-only callers', () => {
    expect(getPathInlineGhostSuffix('~/Deve', 'Developer')).toBe('loper')
    expect(getPathInlineGhostSuffix('~/Dvl', 'Developer')).toBe('')
  })
})
