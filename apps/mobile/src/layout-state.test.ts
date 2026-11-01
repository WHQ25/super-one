import { describe, expect, it } from 'vitest'
import {
  FOLD_PORTRAIT_STATUS_TRAILING,
  foldGlassBottomInset,
  foldableContentInsets,
  isFoldedCoverWindow,
  isFullBleedScreen,
  isInnerFoldableWindow,
  shouldUseTabletComposer,
  shouldUseTabletMultiPane,
  SIDEBAR_PANE_WIDTH,
  TABLET_MIN_HEIGHT,
  TABLET_SPLIT_MIN_WIDTH,
  workspaceSidebarWidth,
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

  it('keeps a resident sidebar only when the Duo inner panel is held landscape', () => {
    // 2007×2853 px at 3×. Portrait stays a drawer. The cover is 466×678.
    expect(isInnerFoldableWindow(669, 951)).toBe(true)
    expect(isInnerFoldableWindow(951, 669)).toBe(true)
    expect(isInnerFoldableWindow(466, 678)).toBe(false)
    expect(isInnerFoldableWindow(767, 1024)).toBe(false)
    expect(workspaceSidebarWidth(669, 951)).toBe(null)
    expect(workspaceSidebarWidth(951, 669)).toBe(SIDEBAR_PANE_WIDTH)
    expect(workspaceSidebarWidth(466, 678)).toBe(null)
    expect(shouldUseTabletMultiPane(669, 951, 'chat', true)).toBe(false)
    expect(shouldUseTabletMultiPane(669, 951, 'files', true)).toBe(false)
    expect(shouldUseTabletMultiPane(951, 669, 'chat', true)).toBe(true)
    expect(shouldUseTabletMultiPane(951, 669, 'files', true)).toBe(true)
    expect(shouldUseTabletMultiPane(669, 951, 'chat', false)).toBe(false)
    expect(shouldUseTabletMultiPane(466, 678, 'chat', true)).toBe(false)
  })

  it('recognises the folded Duo cover in either orientation', () => {
    expect(isFoldedCoverWindow(466, 678)).toBe(true)
    expect(isFoldedCoverWindow(678, 466)).toBe(true)
    expect(isFoldedCoverWindow(669, 951)).toBe(false)
    expect(isFoldedCoverWindow(951, 669)).toBe(false)
    expect(isFoldedCoverWindow(390, 844)).toBe(false)
  })

  it('caps the Duo glass bottom and keeps a shorter reported inset', () => {
    expect(foldGlassBottomInset(46)).toBe(10)
    expect(foldGlassBottomInset(34)).toBe(10)
    expect(foldGlassBottomInset(8)).toBe(8)
    expect(foldGlassBottomInset(0)).toBe(0)
    expect(foldGlassBottomInset(-4)).toBe(0)
  })

  it('sizes a landscape partial fold to one leaf and leaves portrait a drawer', () => {
    expect(workspaceSidebarWidth(951, 669, 'partial')).toBe(476)
    expect(workspaceSidebarWidth(951, 669, 'flat')).toBe(SIDEBAR_PANE_WIDTH)
    expect(workspaceSidebarWidth(951, 669, 'closed')).toBe(SIDEBAR_PANE_WIDTH)
    expect(workspaceSidebarWidth(669, 951, 'partial')).toBe(null)
    expect(workspaceSidebarWidth(669, 951, 'flat')).toBe(null)
  })

  it('keeps the clock clearance on the session and caps the bottom band', () => {
    expect(foldableContentInsets({ top: 59, bottom: 34 })).toEqual({
      sidebar: 10,
      detailTop: 59,
      detailBottom: 10,
      headerLift: 0,
      headerTrailing: 0,
    })
    expect(foldableContentInsets({ top: 0, bottom: 0 })).toEqual({
      sidebar: 10,
      detailTop: 0,
      detailBottom: 0,
      headerLift: 0,
      headerTrailing: 0,
    })
  })

  it('lets a portrait session header share the corner status band', () => {
    // The clock is only the top-right corner. The header rises into the empty
    // left of the band; the landscape book still starts below the full inset.
    expect(foldableContentInsets({ top: 59, bottom: 34 }, true)).toEqual({
      sidebar: 10,
      detailTop: 59,
      detailBottom: 10,
      headerLift: 49,
      headerTrailing: FOLD_PORTRAIT_STATUS_TRAILING,
    })
    expect(foldableContentInsets({ top: 59, bottom: 34 }, false).headerLift).toBe(0)
    expect(foldableContentInsets({ top: 10, bottom: 34 }, true)).toMatchObject({ headerLift: 0, headerTrailing: 0 })
    expect(foldableContentInsets({ top: 0, bottom: 0 }, true)).toMatchObject({ headerLift: 0, headerTrailing: 0 })
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
    expect(isFullBleedScreen('settings')).toBe(true)
    expect(isFullBleedScreen('pair')).toBe(false)
  })
})
