import { describe, it, expect } from 'vitest'
import {
  ensureBrowseDirectoryPath,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  getClonePreviewGhost,
  getPathInlineGhost,
  getPathInlineGhostSuffix,
  isBareHomePath,
  isBrowseablePathQuery,
  normalizeHomePrefixInput,
} from '@superone/shared/path-browse'

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

describe('getClonePreviewGhost', () => {
  it('previews the repo folder at a directory boundary', () => {
    expect(getClonePreviewGhost('~/Developer/Github/', 'new-api')).toEqual({
      kind: 'preview',
      text: 'new-api',
    })
    expect(getClonePreviewGhost('~', 'new-api')).toEqual({ kind: 'preview', text: 'new-api' })
  })

  it('yields to path completion once a segment is being typed', () => {
    expect(getClonePreviewGhost('~/Developer/Git', 'new-api')).toBeNull()
  })

  it('returns null without a repo name', () => {
    expect(getClonePreviewGhost('~/Developer/Github/', '')).toBeNull()
    expect(getClonePreviewGhost('~/Developer/Github/', null)).toBeNull()
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

  it('stays silent at a directory boundary — nothing has been typed to complete', () => {
    expect(getPathInlineGhost('~/', 'Developer')).toBeNull()
    expect(getPathInlineGhost('~', 'Developer')).toBeNull()
    expect(getPathInlineGhost('~/Projects/', 'super-one')).toBeNull()
  })

  it('does not ghost a non-prefix fuzzy match', () => {
    expect(getPathInlineGhost('~/Dvl', 'Developer')).toBeNull()
  })

  it('returns null without a prefix match', () => {
    expect(getPathInlineGhost('~/xyz', 'Developer')).toBeNull()
    expect(getPathInlineGhost('~/Deve', null)).toBeNull()
    expect(getPathInlineGhost('~/Deve', '')).toBeNull()
  })

  it('keeps the legacy suffix helper for prefix-only callers', () => {
    expect(getPathInlineGhostSuffix('~/Deve', 'Developer')).toBe('loper')
    expect(getPathInlineGhostSuffix('~/Dvl', 'Developer')).toBe('')
  })
})
