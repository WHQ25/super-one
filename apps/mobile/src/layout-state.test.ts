import { describe, expect, it } from 'vitest'
import { isFullBleedScreen, shouldUseTabletMultiPane, TABLET_SPLIT_MIN_WIDTH } from './layout-state'

describe('responsive shell layout', () => {
  it('uses a persistent master pane at the tablet breakpoint', () => {
    expect(shouldUseTabletMultiPane(TABLET_SPLIT_MIN_WIDTH - 1, 'chat', true)).toBe(false)
    expect(shouldUseTabletMultiPane(TABLET_SPLIT_MIN_WIDTH, 'chat', true)).toBe(true)
    expect(shouldUseTabletMultiPane(1024, 'settings', true)).toBe(true)
    expect(shouldUseTabletMultiPane(1024, 'worktree', true)).toBe(true)
    expect(shouldUseTabletMultiPane(1024, 'branch', true)).toBe(true)
  })

  it('keeps onboarding and unselected projects single-pane', () => {
    expect(shouldUseTabletMultiPane(1024, 'pair', true)).toBe(false)
    expect(shouldUseTabletMultiPane(1024, 'chat', false)).toBe(false)
  })

  it('drops the page gutter for screens that own their full-width rows', () => {
    expect(isFullBleedScreen('chat')).toBe(true)
    expect(isFullBleedScreen('terminal')).toBe(true)
    expect(isFullBleedScreen('worktree')).toBe(true)
    expect(isFullBleedScreen('branch')).toBe(true)
    expect(isFullBleedScreen('project-picker')).toBe(true)
    expect(isFullBleedScreen('add-project')).toBe(true)
    expect(isFullBleedScreen('settings')).toBe(false)
    expect(isFullBleedScreen('projects')).toBe(false)
  })
})
