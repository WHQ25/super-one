import { describe, expect, it } from 'vitest'
import { localBranchNames, trackingCheckoutPlan, trackingRefNames } from './branch-refs'

describe('tracking refs', () => {
  it('drops symbolic HEAD refs and blank lines', () => {
    expect(trackingRefNames('origin\norigin/main\norigin/HEAD\nHEAD\n\norigin/feat\n')).toEqual([
      'origin/main',
      'origin/feat',
    ])
  })

  it('keeps a nested branch name after the remote', () => {
    expect(localBranchNames('main\n feature/login \n')).toEqual(['main', 'feature/login'])
  })
})

describe('trackingCheckoutPlan', () => {
  it('creates a local tracking branch when the short name is missing', () => {
    expect(trackingCheckoutPlan('origin/feature/login', ['main'])).toEqual({
      branch: 'feature/login',
      track: 'origin/feature/login',
    })
  })

  it('checks out the existing local branch and does not check out the remote ref', () => {
    expect(trackingCheckoutPlan('origin/main', ['main', 'feat'])).toEqual({
      branch: 'main',
      track: null,
    })
  })

  it('rejects a ref that is not remote/branch', () => {
    expect(trackingCheckoutPlan('main', [])).toBeNull()
    expect(trackingCheckoutPlan('origin/HEAD', [])).toBeNull()
    expect(trackingCheckoutPlan('origin/', [])).toBeNull()
  })
})
