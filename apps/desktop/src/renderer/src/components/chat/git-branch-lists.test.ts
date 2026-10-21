import { describe, expect, it } from 'vitest'
import { readBranchLists, trackingCheckoutPlan } from './git-branch-lists'

describe('readBranchLists', () => {
  it('keeps a legacy string array as local branches', () => {
    expect(readBranchLists(['main', 'feat'])).toEqual({ local: ['main', 'feat'], tracking: [] })
  })

  it('reads the two lists and ignores anything else', () => {
    expect(readBranchLists({ local: ['main'], tracking: ['origin/main', 1] })).toEqual({
      local: ['main'],
      tracking: ['origin/main'],
    })
    expect(readBranchLists(null)).toEqual({ local: [], tracking: [] })
  })
})

describe('tracking checkout', () => {
  it('never asks to check out the remote-tracking ref', () => {
    const created = trackingCheckoutPlan('origin/feature/login', ['main'])
    expect(created).toEqual({ branch: 'feature/login', track: 'origin/feature/login' })
    expect(created?.branch).not.toBe('origin/feature/login')
    expect(trackingCheckoutPlan('origin/main', ['main'])?.track).toBeNull()
  })
})
