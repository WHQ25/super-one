import { describe, expect, it } from 'vitest'
import { branchToCreate, filterBranches } from './branch-picker-state'

const BRANCHES = ['main', 'feat/mobile-ui', 'fix/Pairing']

describe('filterBranches', () => {
  it('returns every branch for an empty query', () => {
    expect(filterBranches(BRANCHES, '   ')).toEqual(BRANCHES)
  })

  it('matches case-insensitively on any part of the name', () => {
    expect(filterBranches(BRANCHES, 'PAIR')).toEqual(['fix/Pairing'])
    expect(filterBranches(BRANCHES, 'i')).toEqual(['main', 'feat/mobile-ui', 'fix/Pairing'])
  })
})

describe('branchToCreate', () => {
  it('offers nothing for an empty query', () => {
    expect(branchToCreate(BRANCHES, '  ')).toBeNull()
  })

  it('offers the trimmed name when nothing matches', () => {
    expect(branchToCreate(BRANCHES, '  feat/new  ')).toBe('feat/new')
  })

  it('refuses a name an existing branch already spells, ignoring case', () => {
    expect(branchToCreate(BRANCHES, 'MAIN')).toBeNull()
    expect(branchToCreate(BRANCHES, 'fix/pairing')).toBeNull()
  })
})
