import { describe, expect, it } from 'vitest'
import {
  isFullBleedScreen,
  shouldUseTabletComposer,
  shouldUseTabletMultiPane,
  TABLET_MIN_HEIGHT,
  TABLET_SPLIT_MIN_WIDTH,
} from './layout-state'

describe('responsive shell layout', () => {
  it('uses a persistent master pane at the tablet breakpoint', () => {
    expect(shouldUseTabletMultiPane(TABLET_SPLIT_MIN_WIDTH - 1, 1024, 'chat', true)).toBe(false)
    expect(shouldUseTabletMultiPane(TABLET_SPLIT_MIN_WIDTH, 1024, 'chat', true)).toBe(true)
    expect(shouldUseTabletMultiPane(1024, 768, 'settings', true)).toBe(true)
    expect(shouldUseTabletMultiPane(1024, 768, 'worktree', true)).toBe(true)
    expect(shouldUseTabletMultiPane(1024, 768, 'branch', true)).toBe(true)
    // This is the whole reason additional folders is a route: on a tablet it
    // reads as a panel beside the session list, on a phone as a page, with no
    // width branch of its own.
    expect(shouldUseTabletMultiPane(1024, 768, 'add-dir', true)).toBe(true)
    expect(shouldUseTabletMultiPane(1024, 768, 'collab-request', true)).toBe(true)
    expect(shouldUseTabletMultiPane(TABLET_SPLIT_MIN_WIDTH - 1, 1024, 'add-dir', true)).toBe(false)
  })

  it('keeps onboarding and unselected projects single-pane', () => {
    expect(shouldUseTabletMultiPane(1024, 768, 'pair', true)).toBe(false)
    expect(shouldUseTabletMultiPane(1024, 768, 'chat', false)).toBe(false)
  })

  it('on a landscape phone, only chat keeps the sidebar', () => {
    const landscapePhone = { width: 852, height: 390 }
    expect(shouldUseTabletMultiPane(landscapePhone.width, landscapePhone.height, 'chat', true)).toBe(true)
    expect(shouldUseTabletMultiPane(landscapePhone.width, landscapePhone.height, 'files', true)).toBe(false)
    expect(shouldUseTabletMultiPane(landscapePhone.width, landscapePhone.height, 'terminal', true)).toBe(false)
    expect(shouldUseTabletMultiPane(landscapePhone.width, landscapePhone.height, 'settings', true)).toBe(false)
    expect(shouldUseTabletMultiPane(landscapePhone.width, landscapePhone.height, 'add-dir', true)).toBe(false)
  })

  it('keeps the compact composer on a landscape phone', () => {
    // Wide enough for the sidebar (852 ≥ 768) but too short for the boxed input.
    expect(shouldUseTabletComposer(852, 390)).toBe(false)
    expect(shouldUseTabletComposer(TABLET_SPLIT_MIN_WIDTH, TABLET_MIN_HEIGHT - 1)).toBe(false)
    expect(shouldUseTabletComposer(390, 844)).toBe(false)
  })

  it('uses the boxed composer only when the window is both wide and tall', () => {
    expect(shouldUseTabletComposer(TABLET_SPLIT_MIN_WIDTH, TABLET_MIN_HEIGHT)).toBe(true)
    expect(shouldUseTabletComposer(1024, 768)).toBe(true)
  })

  it('drops the page gutter for screens that own their full-width rows', () => {
    expect(isFullBleedScreen('chat')).toBe(true)
    expect(isFullBleedScreen('terminal')).toBe(true)
    expect(isFullBleedScreen('worktree')).toBe(true)
    expect(isFullBleedScreen('branch')).toBe(true)
    expect(isFullBleedScreen('add-dir')).toBe(true)
    expect(isFullBleedScreen('collab-request')).toBe(true)
    expect(isFullBleedScreen('project-picker')).toBe(true)
    expect(isFullBleedScreen('add-project')).toBe(true)
    expect(isFullBleedScreen('session-search')).toBe(true)
    expect(isFullBleedScreen('settings')).toBe(false)
    expect(isFullBleedScreen('pair')).toBe(false)
  })
})
