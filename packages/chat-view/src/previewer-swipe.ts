/**
 * Pointer arbitration for the phone's files previewer: one pointer sequence on
 * the stage is either a tap (open the file), a horizontal swipe (previous /
 * next), or a vertical drag the stage leaves to the scroller. The stage sets
 * `touch-action: pan-y`, so the browser owns vertical scrolling; this only has
 * to tell a tap from a horizontal swipe and lock the axis early enough that a
 * diagonal drag does not do both.
 */

/** Movement below this is still a tap: fingers are not styluses. */
export const TAP_SLOP_PX = 8
/** Horizontal travel that commits to a file switch. */
export const SWIPE_THRESHOLD_PX = 40

export interface SwipeTracking {
  readonly pointerId: number
  readonly startX: number
  readonly startY: number
  readonly dx: number
  readonly dy: number
  /** Decided once the pointer leaves the tap slop; `none` until then. */
  readonly axis: 'none' | 'x' | 'y'
}

export type SwipeOutcome = 'tap' | 'prev' | 'next' | 'none'

export function beginSwipe(pointerId: number, x: number, y: number): SwipeTracking {
  return { pointerId, startX: x, startY: y, dx: 0, dy: 0, axis: 'none' }
}

/** Fold a move into the tracking; the axis locks the first time the slop is exceeded. */
export function trackSwipe(state: SwipeTracking, x: number, y: number): SwipeTracking {
  const dx = x - state.startX
  const dy = y - state.startY
  let axis = state.axis
  if (axis === 'none' && (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX)) {
    axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
  }
  return { ...state, dx, dy, axis }
}

/**
 * What the release means. A vertical drag is never a tap: the scroller moved,
 * and a file opening on top of that is the classic phone misfire. A horizontal
 * drag short of the threshold is also nothing — the finger backed out.
 */
export function endSwipe(state: SwipeTracking): SwipeOutcome {
  if (state.axis === 'none') return 'tap'
  if (state.axis === 'y') return 'none'
  if (state.dx <= -SWIPE_THRESHOLD_PX) return 'next'
  if (state.dx >= SWIPE_THRESHOLD_PX) return 'prev'
  return 'none'
}
