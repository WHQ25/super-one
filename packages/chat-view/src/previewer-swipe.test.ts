import { describe, expect, it } from 'vitest'
import { beginSwipe, endSwipe, SWIPE_THRESHOLD_PX, TAP_SLOP_PX, trackSwipe } from './previewer-swipe'

function drag(points: Array<[number, number]>) {
  let state = beginSwipe(1, 100, 100)
  for (const [x, y] of points) state = trackSwipe(state, x, y)
  return endSwipe(state)
}

describe('previewer swipe arbitration', () => {
  it('reads a release inside the slop as a tap, even after a small wobble', () => {
    expect(drag([])).toBe('tap')
    expect(drag([[100 + TAP_SLOP_PX, 100], [103, 101]])).toBe('tap')
  })

  it('switches files on a horizontal drag past the threshold, in the direction of travel', () => {
    expect(drag([[100 - SWIPE_THRESHOLD_PX, 102]])).toBe('next')
    expect(drag([[100 + SWIPE_THRESHOLD_PX, 98]])).toBe('prev')
  })

  it('does nothing on a horizontal drag that backs out before the threshold — and never taps', () => {
    expect(drag([[130, 100], [110, 100]])).toBe('none')
  })

  it('leaves a drag that starts vertical to the scroller, however far it later goes sideways', () => {
    expect(drag([[101, 120], [180, 130]])).toBe('none')
  })

  it('locks the axis on the first move past the slop, so a later vertical wander keeps a swipe', () => {
    expect(drag([[120, 100], [160, 140]])).toBe('prev')
  })
})
