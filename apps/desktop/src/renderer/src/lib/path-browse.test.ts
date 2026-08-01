import { describe, it, expect } from 'vitest'
import {
  ensureBrowseDirectoryPath,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
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
