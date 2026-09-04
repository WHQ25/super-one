import { describe, expect, it } from 'vitest'
import { shouldUseTabletMultiPane, TABLET_SPLIT_MIN_WIDTH } from './layout-state'

describe('responsive shell layout', () => {
  it('uses a persistent master pane at the tablet breakpoint', () => {
    expect(shouldUseTabletMultiPane(TABLET_SPLIT_MIN_WIDTH - 1, 'chat', true)).toBe(false)
    expect(shouldUseTabletMultiPane(TABLET_SPLIT_MIN_WIDTH, 'chat', true)).toBe(true)
    expect(shouldUseTabletMultiPane(1024, 'settings', true)).toBe(true)
  })

  it('keeps onboarding and unselected projects single-pane', () => {
    expect(shouldUseTabletMultiPane(1024, 'pair', true)).toBe(false)
    expect(shouldUseTabletMultiPane(1024, 'chat', false)).toBe(false)
  })
})
