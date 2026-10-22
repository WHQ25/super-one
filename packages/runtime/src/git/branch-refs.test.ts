import { describe, expect, it } from 'vitest'
import { checkoutExistingBranch, localBranchList, localBranchNames, readLocalBranchNames } from './branch-refs'

describe('localBranchNames', () => {
  it('keeps a nested branch name and drops blank lines', () => {
    expect(localBranchNames('main\n feature/login \n\n')).toEqual(['main', 'feature/login'])
  })
})

describe('localBranchList', () => {
  it('reads a legacy string array as local names', () => {
    expect(localBranchList(['main', 'feat', 1])).toEqual({ local: ['main', 'feat'] })
  })

  it('prefers local over branches and keeps a failed read', () => {
    expect(localBranchList({ local: ['main'], branches: ['other'] })).toEqual({ local: ['main'] })
    expect(localBranchList({ branches: ['main', 'feat'] })).toEqual({ local: ['main', 'feat'] })
    expect(localBranchList({ branches: [], error: 'timed out' })).toEqual({ local: [], error: 'timed out' })
    expect(localBranchList({ error: 'not a remote project' })).toEqual({ local: [], error: 'not a remote project' })
    expect(localBranchList(null)).toEqual({ local: [] })
  })
})

describe('shared branch commands', () => {
  it('reads local names through the caller runner', async () => {
    const git = async (args: string[]) => {
      expect(args).toEqual(['branch', '--format=%(refname:short)'])
      return 'main\n feature/login \n'
    }
    expect(await readLocalBranchNames(git)).toEqual(['main', 'feature/login'])
  })

  it('checks out a sanitized branch name', async () => {
    const git = async (args: string[]) => {
      expect(args).toEqual(['checkout', 'feature/login'])
      return ''
    }
    await checkoutExistingBranch(git, ' feature/login ')
  })
})
