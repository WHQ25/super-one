import { describe, expect, it } from 'vitest'
import { MIN_CHAT_WIDTH, MINI_WINDOW_SIZE } from '@superone/shared/agent-types'
import { buildFoldSteps, panelOpenFraction, type ShellLayout } from './window-mini-mode'

/** Default shell: sidebar left, activity right — the chat column sits nearer the left. */
const CHAT_ON_THE_LEFT: ShellLayout = {
  sidebarWidth: 260,
  activityWidth: 400,
  viewportWidth: 1440,
}

describe('mini-window fold geometry', () => {
  it('emits only size changes so the native window origin stays fixed', () => {
    expect(buildFoldSteps(CHAT_ON_THE_LEFT)).toEqual([{
      durationMs: 320,
      widthDelta: MINI_WINDOW_SIZE.width - CHAT_ON_THE_LEFT.viewportWidth,
      height: MINI_WINDOW_SIZE.height,
    }])
  })

  it('folds every axis in one move: chat, both panels and the height together', () => {
    const steps = buildFoldSteps(CHAT_ON_THE_LEFT)
    expect(steps).toHaveLength(1)
    // The chat and both panels shed at once until one minimum-width chat column remains.
    expect(steps[0]).toMatchObject({
      widthDelta: MINI_WINDOW_SIZE.width - CHAT_ON_THE_LEFT.viewportWidth,
      height: MINI_WINDOW_SIZE.height,
    })
  })

  it('measures the delta against the viewport so the fold lands with no correction snap', () => {
    // Borders and gutters mean the columns sum to less than the viewport; deriving the
    // delta from them left a few-pixel instant jump at the very end of the fold.
    const withChrome = { ...CHAT_ON_THE_LEFT, sidebarWidth: 258, activityWidth: 398 }
    expect(buildFoldSteps(withChrome)[0].widthDelta).toBe(MINI_WINDOW_SIZE.width - 1440)
  })

  it('does not resize the width when the window is already at the mini width', () => {
    const steps = buildFoldSteps({ ...CHAT_ON_THE_LEFT, viewportWidth: MINI_WINDOW_SIZE.width })
    expect(steps[0].widthDelta).toBe(0)
  })

  it('uses the chat minimum as the mini-window target width', () => {
    expect(MINI_WINDOW_SIZE.width).toBe(MIN_CHAT_WIDTH)
    expect(MINI_WINDOW_SIZE.minWidth).toBe(MIN_CHAT_WIDTH)
  })
})

describe('panels tracked off the window size', () => {
  const TRACKER = {
    expandedWidth: CHAT_ON_THE_LEFT.viewportWidth,
    totalDelta: CHAT_ON_THE_LEFT.viewportWidth - MINI_WINDOW_SIZE.width,
  }

  it('is fully open at the start width and fully shut at the mini width', () => {
    expect(panelOpenFraction(TRACKER, TRACKER.expandedWidth)).toBe(1)
    expect(panelOpenFraction(TRACKER, MINI_WINDOW_SIZE.width)).toBe(0)
  })

  it('reads the same fraction whichever direction the window is moving', () => {
    // Nothing in it knows about folding vs unfolding — it is a function of width alone,
    // which is what keeps the panels from drifting out of step with the window.
    const midpoint = (TRACKER.expandedWidth + MINI_WINDOW_SIZE.width) / 2
    expect(panelOpenFraction(TRACKER, midpoint)).toBeCloseTo(0.5, 5)
  })

  it('clamps rather than overshooting when the window is dragged past either end', () => {
    expect(panelOpenFraction(TRACKER, 2000)).toBe(1)
    expect(panelOpenFraction(TRACKER, 100)).toBe(0)
  })
})
