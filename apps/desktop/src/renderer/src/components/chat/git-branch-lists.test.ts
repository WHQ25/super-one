import { describe, expect, it } from 'vitest'
import { readBranchLists } from './git-branch-lists'

describe('readBranchLists', () => {
  it('keeps a legacy string array as local branches', () => {
    expect(readBranchLists(['main', 'feat'])).toEqual({ local: ['main', 'feat'] })
  })

  it('reads local names and does not treat an error as an empty repository', () => {
    expect(readBranchLists({ local: ['main'], tracking: ['origin/main', 1] })).toEqual({ local: ['main'] })
    expect(readBranchLists({ branches: ['main'] })).toEqual({ local: ['main'] })
    expect(readBranchLists({ local: [], error: 'timed out' })).toEqual({ local: [], error: 'timed out' })
    expect(readBranchLists(null)).toEqual({ local: [] })
  })
})
