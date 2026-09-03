import { describe, expect, it } from 'vitest'
import { planPrune, versionsFromKeys } from './prune-releases'

const PRESENT = ['0.60.0-alpha', '0.61.0-alpha', '0.62.0-alpha', '0.62.1-alpha']

describe('planPrune — single', () => {
  it('removes only the requested version', () => {
    const plan = planPrune({ mode: 'single', version: '0.61.0-alpha', present: PRESENT, liveVersions: [] })
    expect(plan.remove).toEqual(['0.61.0-alpha'])
    expect(plan.keep.map((k) => k.version)).toEqual(['0.60.0-alpha', '0.62.0-alpha', '0.62.1-alpha'])
  })

  it('reports a version that is not archived instead of silently doing nothing', () => {
    const plan = planPrune({ mode: 'single', version: '9.9.9', present: PRESENT, liveVersions: [] })
    expect(plan.remove).toEqual([])
    expect(plan.missing).toEqual(['9.9.9'])
  })

  it('accepts a v-prefixed tag', () => {
    expect(planPrune({ mode: 'single', version: 'v0.60.0-alpha', present: PRESENT, liveVersions: [] }).remove)
      .toEqual(['0.60.0-alpha'])
  })
})

describe('planPrune — older-than', () => {
  it('removes everything below the boundary and keeps the boundary itself', () => {
    const plan = planPrune({ mode: 'older-than', version: '0.62.0-alpha', present: PRESENT, liveVersions: [] })
    expect(plan.remove).toEqual(['0.60.0-alpha', '0.61.0-alpha'])
    expect(plan.keep.map((k) => k.version)).toEqual(['0.62.0-alpha', '0.62.1-alpha'])
  })

  it('orders by semver, not by string', () => {
    const plan = planPrune({
      mode: 'older-than',
      version: '0.10.0-alpha',
      present: ['0.9.0-alpha', '0.10.0-alpha', '0.11.0-alpha'],
      liveVersions: [],
    })
    expect(plan.remove).toEqual(['0.9.0-alpha'])
  })
})

describe('the live-version guard', () => {
  // A pointer yml hands clients the exact v<version>/ path. Deleting that
  // version breaks every download and every update on the variant, and nothing
  // in CI would report it.
  it('never removes a version a channel pointer still references', () => {
    const plan = planPrune({
      mode: 'older-than',
      version: '0.62.0-alpha',
      present: PRESENT,
      liveVersions: ['0.61.0-alpha'],
    })
    expect(plan.remove).toEqual(['0.60.0-alpha'])
    expect(plan.keep).toContainEqual({ version: '0.61.0-alpha', reason: 'published as the current latest' })
  })

  it('holds even when that version is the one explicitly requested', () => {
    const plan = planPrune({
      mode: 'single',
      version: '0.62.1-alpha',
      present: PRESENT,
      liveVersions: ['0.62.1-alpha'],
    })
    expect(plan.remove).toEqual([])
  })

  it('protects every platform pointer, not just the first', () => {
    const plan = planPrune({
      mode: 'older-than',
      version: '0.62.1-alpha',
      present: PRESENT,
      liveVersions: ['0.60.0-alpha', '0.62.0-alpha'],
    })
    expect(plan.remove).toEqual(['0.61.0-alpha'])
  })
})

describe('versionsFromKeys', () => {
  it('reads versions from one variant prefix only', () => {
    const keys = [
      'alpha/v0.62.0-alpha/SuperOne Alpha-0.62.0-alpha.dmg',
      'alpha/v0.62.0-alpha/SuperOne Alpha-0.62.0-alpha.dmg.blockmap',
      'stable/v0.63.0/SuperOne-0.63.0.dmg',
    ]
    expect(versionsFromKeys(keys, 'alpha')).toEqual(['0.62.0-alpha'])
    expect(versionsFromKeys(keys, 'stable')).toEqual(['0.63.0'])
  })

  it('ignores the version-less pointer and fixed-link keys', () => {
    const keys = ['alpha/latest-mac.yml', 'alpha/latest/SuperOne Alpha.dmg', 'alpha/v0.62.0-alpha/x.dmg']
    expect(versionsFromKeys(keys, 'alpha')).toEqual(['0.62.0-alpha'])
  })
})
