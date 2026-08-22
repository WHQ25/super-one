/**
 * Touch gestures are a shape traced over TIME, not an event.
 *
 * A tap can be one message because the guest only needs where it landed, but a
 * swipe, a long press and a pinch are all read from how the contacts moved between
 * frames -- iOS decides "flick" versus "drag" from the velocity at release, and
 * decides "long press" purely from how long nothing moved. Android reads the same
 * things off the same kind of series. So these compile down to a timed series of
 * contact updates rather than to a single input.
 *
 * The series is platform-neutral: it says where the fingers are and when, and each
 * backend translates a step into whatever its own transport speaks (a
 * `IosSimulatorInput` for the simulator helper, an `INJECT_TOUCH_EVENT` for scrcpy).
 * Keeping the timing here means both platforms share the part that was measured
 * against real guests, rather than each re-deriving what counts as a flick.
 *
 * Kept as pure functions returning the series: the timing is the part worth testing,
 * and it is impossible to assert on if it is buried in an async send loop.
 */

/**
 * Phases a synthesized gesture produces.
 *
 * Deliberately narrower than what a transport may accept — cancellation is not a
 * phase any of these emit, it is a separate message a backend sends when a gesture
 * is interrupted.
 */
export type TouchPhase = 'began' | 'moved' | 'ended'

export interface TouchContact {
  id: number
  xRatio: number
  yRatio: number
  phase: TouchPhase
}

/**
 * One step of a gesture, plus how long to wait after it before sending the next.
 *
 * `tap` stays its own kind rather than expanding into a began/ended pair: a backend
 * whose transport has a real tap message should send that one message, and turning
 * every tap into a two-message series here would take that choice away from it.
 */
export type TouchStep =
  | { kind: 'tap'; xRatio: number; yRatio: number; delayMs: number }
  | { kind: 'contacts'; contacts: TouchContact[]; delayMs: number }

/**
 * How many fingers a gesture may use.
 *
 * Two, which both platforms clear: the simulator's HID bridge carries two contacts,
 * and scrcpy addresses pointers by a 64-bit id with no practical ceiling. Nothing
 * here needs a third.
 */
const MAX_TOUCH_CONTACTS = 2

/** Roughly a frame at 60Hz. Finer than this and the transport's queue coalesces it away. */
const STEP_MS = 16

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)

/** iOS starts treating a press as "long" at ~0.5s; overshoot so it always registers. */
export const LONG_PRESS_MS = 700

/**
 * Below this a drag reads as a flick and the list keeps scrolling after release;
 * above it, as a deliberate drag that stops where it was let go. Callers that care
 * pass their own.
 */
export const SWIPE_MS = 180
export const DRAG_MS = 600

function interpolate(from: number, to: number, progress: number): number {
  // Pinned at the ends rather than computed, so a gesture lands exactly where it was
  // aimed. Floating point otherwise leaves the release point a hair off target, and
  // the release point is what the guest reads to decide where a flick lands.
  if (progress <= 0) return from
  if (progress >= 1) return to
  return from + (to - from) * progress
}

/**
 * Steps for a gesture lasting `durationMs`, always including both endpoints.
 *
 * At least two samples, or there is no movement for the guest to measure and the
 * whole gesture reads as a tap.
 */
function progressSteps(durationMs: number): number[] {
  const count = Math.max(2, Math.round(durationMs / STEP_MS))
  return Array.from({ length: count }, (_, index) => index / (count - 1))
}

/** A press that stays down long enough for the guest to call it a long press. */
export function synthesizeLongPress(
  xRatio: number,
  yRatio: number,
  holdMs: number = LONG_PRESS_MS,
): TouchStep[] {
  const x = clamp01(xRatio)
  const y = clamp01(yRatio)
  return [
    { kind: 'contacts', contacts: [{ id: 1, xRatio: x, yRatio: y, phase: 'began' }], delayMs: holdMs },
    // A stationary 'moved' before release: without it a guest that saw only
    // began/ended can treat the whole thing as a plain tap.
    { kind: 'contacts', contacts: [{ id: 1, xRatio: x, yRatio: y, phase: 'moved' }], delayMs: STEP_MS },
    { kind: 'contacts', contacts: [{ id: 1, xRatio: x, yRatio: y, phase: 'ended' }], delayMs: 0 },
  ]
}

/**
 * Two taps close enough together to be read as one double tap.
 *
 * The gap has to clear the guest's own double-tap window (~300ms at the far end)
 * with room to spare, but stay short enough that a slow queue does not split them.
 */
export function synthesizeDoubleTap(xRatio: number, yRatio: number): TouchStep[] {
  const x = clamp01(xRatio)
  const y = clamp01(yRatio)
  return [
    { kind: 'tap', xRatio: x, yRatio: y, delayMs: 120 },
    { kind: 'tap', xRatio: x, yRatio: y, delayMs: 0 },
  ]
}

/**
 * A one-finger drag from one point to another.
 *
 * Sent as explicit contact updates rather than through a transport's own `drag`
 * because the caller has to be able to choose the duration: that single number is
 * what separates a flick from a drag, and it is the difference between a list that
 * coasts to a new position and one that lands where it was released.
 */
export function synthesizeSwipe(
  fromXRatio: number,
  fromYRatio: number,
  toXRatio: number,
  toYRatio: number,
  durationMs: number = SWIPE_MS,
): TouchStep[] {
  const x0 = clamp01(fromXRatio)
  const y0 = clamp01(fromYRatio)
  const x1 = clamp01(toXRatio)
  const y1 = clamp01(toYRatio)
  const progresses = progressSteps(durationMs)
  const perStep = durationMs / (progresses.length - 1)

  return progresses.map((progress, index) => {
    const last = index === progresses.length - 1
    const phase: TouchPhase = index === 0 ? 'began' : last ? 'ended' : 'moved'
    return {
      kind: 'contacts',
      contacts: [{
        id: 1,
        xRatio: interpolate(x0, x1, progress),
        yRatio: interpolate(y0, y1, progress),
        phase,
      }],
      delayMs: last ? 0 : perStep,
    } satisfies TouchStep
  })
}

/**
 * Two contacts moving symmetrically toward or away from a centre.
 *
 * `scale` is the factor the separation ends at: below 1 pinches in, above 1 spreads
 * out. The pair travels along the horizontal axis; because these are framebuffer
 * ratios on a non-square screen a circle would come out an ellipse anyway, and only
 * the change in separation is what the guest reads.
 */
export function synthesizePinch(
  centerXRatio: number,
  centerYRatio: number,
  scale: number,
  options: { startSpanRatio?: number; durationMs?: number } = {},
): TouchStep[] {
  if (MAX_TOUCH_CONTACTS < 2) {
    throw new Error('Pinch needs two touch contacts.')
  }
  const cx = clamp01(centerXRatio)
  const cy = clamp01(centerYRatio)
  const durationMs = options.durationMs ?? 320
  // Wide enough that the two contacts are unambiguously separate fingers, narrow
  // enough that a pinch near an edge does not clamp both of them onto the bezel.
  const startSpan = options.startSpanRatio ?? 0.18
  const endSpan = startSpan * Math.max(scale, 0.01)
  const progresses = progressSteps(durationMs)
  const perStep = durationMs / (progresses.length - 1)

  return progresses.map((progress, index) => {
    const last = index === progresses.length - 1
    const phase: TouchPhase = index === 0 ? 'began' : last ? 'ended' : 'moved'
    const half = interpolate(startSpan, endSpan, progress) / 2
    return {
      kind: 'contacts',
      contacts: [
        { id: 1, xRatio: clamp01(cx - half), yRatio: cy, phase },
        { id: 2, xRatio: clamp01(cx + half), yRatio: cy, phase },
      ],
      delayMs: last ? 0 : perStep,
    } satisfies TouchStep
  })
}

/** Total wall-clock a series will take, for timeout budgeting. */
export function gestureDurationMs(steps: readonly TouchStep[]): number {
  return steps.reduce((total, step) => total + step.delayMs, 0)
}
