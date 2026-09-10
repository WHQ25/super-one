import { useEffect, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'

/** How long a finger has to rest before the press counts as a long press. */
export const LONG_PRESS_DELAY_MS = 450
/** A finger that travels further than this is scrolling, not pressing. */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10

export interface LongPressPoint {
  x: number
  y: number
}

export interface LongPressTrackerOptions {
  onLongPress: (point: LongPressPoint) => void
  delayMs?: number
  moveTolerancePx?: number
  /** Injectable timers so the tracker can be driven from a unit test. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface LongPressTracker {
  /** A pointer went down; arms the timer. */
  down: (point: LongPressPoint) => void
  /** The pointer moved; cancels once it leaves the tolerance radius. */
  move: (point: LongPressPoint) => void
  /** The pointer lifted or the browser took the gesture (scroll); disarms. */
  cancel: () => void
  /**
   * Whether the most recent press fired. Reset by the next `down`. The
   * caller uses it to swallow the click a browser may still dispatch after
   * a long press.
   */
  didFire: () => boolean
  dispose: () => void
}

/**
 * Framework-agnostic long-press state machine. Pointer events on a phone
 * arrive as down → (moves) → up/cancel; a press counts only if the finger
 * stays put for `delayMs`. Scrolling cancels through `move` (distance) or
 * `cancel` (the browser emits `pointercancel` when it claims a scroll).
 */
export function createLongPressTracker(options: LongPressTrackerOptions): LongPressTracker {
  const delayMs = options.delayMs ?? LONG_PRESS_DELAY_MS
  const tolerance = options.moveTolerancePx ?? LONG_PRESS_MOVE_TOLERANCE_PX
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  let origin: LongPressPoint | null = null
  let handle: unknown = null
  let fired = false

  const disarm = () => {
    if (handle != null) clearTimer(handle)
    handle = null
    origin = null
  }

  return {
    down(point) {
      disarm()
      fired = false
      origin = point
      handle = setTimer(() => {
        handle = null
        if (!origin) return
        const at = origin
        origin = null
        fired = true
        options.onLongPress(at)
      }, delayMs)
    },
    move(point) {
      if (!origin) return
      const dx = point.x - origin.x
      const dy = point.y - origin.y
      if (dx * dx + dy * dy > tolerance * tolerance) disarm()
    },
    cancel: disarm,
    didFire: () => fired,
    dispose: disarm,
  }
}

export interface LongPressHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void
}

/**
 * Spread the returned handlers onto the element that should react to a long
 * press. `contextmenu` is swallowed so Android's WebView does not open its own
 * text-selection handles over ours, and the click that trails a fired press
 * is stopped before it reaches anything inside the bubble.
 */
export function useLongPress(onLongPress: (point: LongPressPoint) => void): LongPressHandlers {
  const callbackRef = useRef(onLongPress)
  callbackRef.current = onLongPress
  const tracker = useMemo(
    () => createLongPressTracker({ onLongPress: (point) => callbackRef.current(point) }),
    [],
  )
  useEffect(() => () => tracker.dispose(), [tracker])

  return useMemo<LongPressHandlers>(() => ({
    onPointerDown: (event) => {
      // Only the primary touch/mouse button arms a press.
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
      tracker.down({ x: event.clientX, y: event.clientY })
    },
    onPointerMove: (event) => tracker.move({ x: event.clientX, y: event.clientY }),
    onPointerUp: () => tracker.cancel(),
    onPointerCancel: () => tracker.cancel(),
    onPointerLeave: () => tracker.cancel(),
    onContextMenu: (event) => event.preventDefault(),
    onClickCapture: (event) => {
      if (!tracker.didFire()) return
      event.preventDefault()
      event.stopPropagation()
    },
  }), [tracker])
}
