/**
 * The fullscreen viewer's touch handling, as a plain state machine over touch
 * lists. It owns the pinch baseline, the pan, the tap/double-tap split and the
 * settle on release; the component only turns what comes back into
 * `Animated.Value`s.
 *
 * It is separated from the component because the bug this shape exists to
 * prevent is invisible from a simulator: a synthesised pinch puts both fingers
 * down at once, while a real hand puts one down and then the other, and the
 * two take different paths through the responder system. Driving these
 * functions directly is the only way to test the sequence a hand produces.
 */

import {
  DOUBLE_TAP_MS,
  MIN_SCALE,
  TAP_SLOP,
  doubleTapTransform,
  panTransform,
  pinchTransform,
  settleTransform,
  touchAngle,
  touchDistance,
  touchMidpoint,
  type ImageTransform,
  type Point,
  type Size,
} from './image-preview-state'

/** One finger, in screen points. */
export type GestureTouch = Point

export interface ImageGesturePorts {
  /** Read at every event: the fit changes when the bytes land or the device turns. */
  layout(): { viewport: Size; fitted: Size }
  current(): ImageTransform
  /** Follow the fingers now, without animation. */
  apply(next: ImageTransform): void
  /** Spring to a resting place. */
  animateTo(next: ImageTransform): void
  /** A tap that was not the second half of a double tap. */
  onSingleTap(): void
  now(): number
}

export interface ImageGesture {
  grant(touches: GestureTouch[]): void
  move(touches: GestureTouch[]): void
  /** `point` is where the last finger left the screen. */
  release(point: GestureTouch): void
  terminate(): void
}

interface Pinch {
  start: ImageTransform & { focal: Point; distance: number; angle: number }
}

/**
 * How the viewer's stage answers the responder system.
 *
 * `onPanResponderTerminationRequest` is the load-bearing one. A second finger
 * landing makes the responder system ask whether this view will give the
 * gesture up, and PanResponder's default answer is yes — so every real
 * two-finger pinch (one finger down, then the other) was terminated and sprung
 * back before it began. A synthesised pinch puts both fingers down at once and
 * never asks, which is why that survived a simulator check; this constant is
 * exported so the policy is covered by a test rather than by a screenshot.
 */
export const IMAGE_GESTURE_RESPONDER_POLICY = {
  onStartShouldSetPanResponder: () => true,
  onMoveShouldSetPanResponder: () => true,
  onPanResponderTerminationRequest: () => false,
  onShouldBlockNativeResponder: () => true,
} as const

export function createImageGesture(ports: ImageGesturePorts): ImageGesture {
  let pinch: Pinch | null = null
  let lastTouch: Point | null = null
  let start: { point: Point; moved: boolean; fingers: number } | null = null
  let lastTap: { at: number; point: Point } | null = null

  /** Coordinates relative to the viewport centre, which is what the geometry expects. */
  const relative = (point: Point): Point => {
    const { viewport } = ports.layout()
    return { x: point.x - viewport.width / 2, y: point.y - viewport.height / 2 }
  }

  const settle = () => {
    const { viewport, fitted } = ports.layout()
    ports.animateTo(settleTransform(ports.current(), viewport, fitted))
  }

  const handleTap = (point: Point) => {
    const now = ports.now()
    const previous = lastTap
    if (previous && now - previous.at < DOUBLE_TAP_MS && touchDistance(previous.point, point) < TAP_SLOP * 3) {
      lastTap = null
      const { viewport, fitted } = ports.layout()
      ports.animateTo(doubleTapTransform(ports.current(), relative(point), viewport, fitted))
      return
    }
    lastTap = { at: now, point }
    // A single tap only hides the chrome, so the second tap of a double tap
    // costs nothing but the toggle it already did — no timer, no lag.
    ports.onSingleTap()
  }

  return {
    grant(touches) {
      const point = touches[0]
      if (!point) return
      // A second finger landing re-grants on some platforms. Keep the gesture
      // that is already running: re-arming `moved` here is how a pinch that
      // travelled a long way could still be released as a tap.
      if (start && touches.length > 1) {
        start.fingers = Math.max(start.fingers, touches.length)
        start.moved = true
        return
      }
      start = { point, moved: false, fingers: touches.length }
      lastTouch = point
      pinch = null
    },

    move(touches) {
      if (!start) return
      if (touches.length >= 2) {
        start.fingers = Math.max(start.fingers, touches.length)
        start.moved = true
        lastTouch = null
        const [a, b] = touches
        const focal = relative(touchMidpoint(a, b))
        const distance = touchDistance(a, b)
        const angle = touchAngle(a, b)
        if (!pinch) {
          pinch = { start: { ...ports.current(), focal, distance, angle } }
          return
        }
        const { viewport, fitted } = ports.layout()
        ports.apply(pinchTransform(pinch.start, { focal, distance, angle }, viewport, fitted))
        return
      }
      const point = touches[0]
      if (!point) return
      // A finger lifted mid-pinch: carry on as a pan from wherever the other one is.
      pinch = null
      if (lastTouch) {
        const delta = { x: point.x - lastTouch.x, y: point.y - lastTouch.y }
        if (ports.current().scale > MIN_SCALE) ports.apply(panTransform(ports.current(), delta))
      }
      if (touchDistance(start.point, point) > TAP_SLOP) start.moved = true
      lastTouch = point
    },

    release(point) {
      const state = start
      start = null
      pinch = null
      lastTouch = null
      settle()
      if (state && !state.moved && state.fingers === 1) handleTap(point)
    },

    terminate() {
      start = null
      pinch = null
      lastTouch = null
      settle()
    },
  }
}
