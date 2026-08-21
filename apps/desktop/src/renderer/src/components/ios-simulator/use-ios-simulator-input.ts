import { useCallback, useEffect, useRef } from 'react'
import type { IosSimulatorTouchContact } from '@superone/shared/ios-simulator'
import {
  IosSimulatorSyntheticGesture,
  classifyIosSimulatorWheelGesture,
} from './ios-simulator-gestures'
import { normalizeFramePoint, rotateFrameDelta, unrotateFrameSize } from './ios-simulator-input'
import { reportIosSimulatorError } from './ios-simulator-report'
import { IosSimulatorTouchTracker } from './ios-simulator-touches'

const SYNTHETIC_GESTURE_IDLE_MS = 140

// Touch samples are throttled on a timer, NOT on requestAnimationFrame: the same
// renderer decodes and paints the simulator's H.264 stream, and rAF callbacks queue
// behind that work.
//
// The throttle is LEADING edge. A trailing-only version made every sample wait the
// full interval even when the pipe was idle, so the effective period became
// (sampleInterval + interval) — traces showed 120Hz input going out at 60Hz with
// half the samples coalesced away, plus a fixed 8ms of added lag on each one.
//
// This oversamples on purpose. SimulatorKit only lets the helper build a motion
// event every 16ms, and the helper holds the newest sample until that window opens
// (see kDragGateNanos in HIDBridge.m), so sampling at half the gate keeps the
// position it emits at most one interval stale. Raising this to the gate period
// would not send more — it would only send older coordinates.
const TOUCH_MOVE_INTERVAL_MS = 8
const NATIVE_ROTATION_WHEEL_GUARD_MS = 180

type SimulatorInput = Parameters<typeof window.environment.iosSimulatorInput>[1]

function wheelPixels(event: WheelEvent, pageSize: number): { deltaX: number; deltaY: number } {
  const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageSize : 1
  return { deltaX: event.deltaX * multiplier, deltaY: event.deltaY * multiplier }
}

export interface IosSimulatorInputApi {
  /** Attach to the device shell wrapping the canvas. */
  shellRef: React.RefObject<HTMLDivElement | null>
  /**
   * The real keyboard focus target, mounted inside the shell.
   *
   * Typing cannot hang off the shell `<div>`: macOS only runs an input method
   * against an editable element, so a Chinese or Japanese IME over a plain div
   * delivers the raw latin keystrokes and never the composed text. A hidden
   * textarea gives the IME somewhere to compose, and `compositionend` hands over
   * the finished string.
   */
  keyboard: {
    ref: React.RefObject<HTMLTextAreaElement | null>
    handlers: {
      onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>
      onCompositionEnd: React.CompositionEventHandler<HTMLTextAreaElement>
      onPaste: React.ClipboardEventHandler<HTMLTextAreaElement>
      onInput: React.FormEventHandler<HTMLTextAreaElement>
    }
  }
  sendInput: (input: SimulatorInput) => Promise<void>
  /**
   * Bound to the element HOSTING the canvas rather than the canvas itself: the
   * canvas is created outside React by the surface registry, so React's synthetic
   * event system cannot reach it. Pointer events bubble up from it to the host, and
   * every coordinate below is measured against `canvas` explicitly rather than
   * `event.currentTarget` — the host is only guaranteed to CONTAIN the picture, not
   * to have its exact rect, and the guest's touch point comes from the picture.
   */
  canvasHandlers: {
    onPointerDown: React.PointerEventHandler<HTMLElement>
    onPointerMove: React.PointerEventHandler<HTMLElement>
    onPointerUp: React.PointerEventHandler<HTMLElement>
    onPointerCancel: React.PointerEventHandler<HTMLElement>
    onLostPointerCapture: React.PointerEventHandler<HTMLElement>
    onPointerEnter: React.PointerEventHandler<HTMLElement>
  }
}

/**
 * Owns everything between a host pointer and the simulator's HID stream: contact
 * tracking, motion throttling, trackpad gestures synthesised into touches, and the
 * text keys typed into a focused device.
 *
 * `enabled` gates the listeners that live outside React's event system (wheel and
 * the native rotate gesture); the returned handlers stay inert on their own.
 *
 * `rotationDegrees` is how far the device shell is turned on screen. Every pointer
 * and wheel sample is measured against the rotated shell, so it has to be undone
 * before the sample means anything to the guest.
 */
export function useIosSimulatorInput(
  { sessionId, enabled, rotationDegrees = 0, canvas }: {
    sessionId: string
    enabled: boolean
    /** Owned by `ios-simulator-surface`; null until a view has attached it. */
    canvas: HTMLCanvasElement | null
    rotationDegrees?: number
  },
): IosSimulatorInputApi {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const keyboardRef = useRef<HTMLTextAreaElement | null>(null)
  const touchTracker = useRef(new IosSimulatorTouchTracker())
  const syntheticGesture = useRef(new IosSimulatorSyntheticGesture())
  const pendingTouchUpdate = useRef<SimulatorInput | null>(null)
  const touchMoveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTouchSentAt = useRef(0)
  const syntheticGestureEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGestureCenter = useRef({ xRatio: 0.5, yRatio: 0.5 })
  const nativeRotationWheelGuardUntil = useRef(0)

  const sendInput = useCallback(async (input: SimulatorInput) => {
    const result = await window.environment.iosSimulatorInput(sessionId, input)
    if (!result.ok) reportIosSimulatorError(result.error ?? 'iOS Simulator input failed.')
  }, [sessionId])

  const pointerRatio = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const bounds = (canvas ?? event.currentTarget).getBoundingClientRect()
    return normalizeFramePoint(bounds, event.clientX, event.clientY, rotationDegrees)
  }, [canvas, rotationDegrees])

  const cancelScheduledTouchMove = useCallback(() => {
    if (touchMoveTimer.current !== null) clearTimeout(touchMoveTimer.current)
    touchMoveTimer.current = null
    pendingTouchUpdate.current = null
  }, [])

  const scheduleTouchMove = useCallback((contacts: IosSimulatorTouchContact[]) => {
    pendingTouchUpdate.current = { type: 'touch.update', contacts }
    // An armed timer already carries whatever the newest sample turns out to be.
    if (touchMoveTimer.current !== null) return
    const queuedAt = performance.now()
    // Only wait out whatever is LEFT of the interval since the last send. An idle
    // pipe dispatches on the next tick instead of sitting on the sample.
    const wait = Math.max(0, TOUCH_MOVE_INTERVAL_MS - (queuedAt - lastTouchSentAt.current))
    touchMoveTimer.current = setTimeout(() => {
      touchMoveTimer.current = null
      const input = pendingTouchUpdate.current
      pendingTouchUpdate.current = null
      if (!input) return
      lastTouchSentAt.current = performance.now()
      void sendInput(input)
    }, wait)
  }, [sendInput])

  const dispatchSyntheticFrames = useCallback(
    (frames: ReturnType<IosSimulatorSyntheticGesture['scroll']>) => {
      frames.forEach((contacts, index) => {
        const isLatestMove = index === frames.length - 1
          && contacts.every((contact) => contact.phase === 'moved')
        if (isLatestMove) {
          scheduleTouchMove(contacts)
          return
        }
        cancelScheduledTouchMove()
        void sendInput({ type: 'touch.update', contacts })
      })
    },
    [cancelScheduledTouchMove, scheduleTouchMove, sendInput],
  )

  const clearSyntheticGestureEndTimer = useCallback(() => {
    if (syntheticGestureEndTimer.current !== null) {
      clearTimeout(syntheticGestureEndTimer.current)
      syntheticGestureEndTimer.current = null
    }
  }, [])

  const finishSyntheticGesture = useCallback((cancelled = false) => {
    clearSyntheticGestureEndTimer()
    const contacts = cancelled
      ? syntheticGesture.current.cancel()
      : syntheticGesture.current.end()
    if (!contacts) return
    cancelScheduledTouchMove()
    void sendInput({ type: 'touch.update', contacts })
  }, [cancelScheduledTouchMove, clearSyntheticGestureEndTimer, sendInput])

  const scheduleSyntheticGestureEnd = useCallback((delay = SYNTHETIC_GESTURE_IDLE_MS) => {
    clearSyntheticGestureEndTimer()
    syntheticGestureEndTimer.current = setTimeout(() => {
      syntheticGestureEndTimer.current = null
      finishSyntheticGesture()
    }, delay)
  }, [clearSyntheticGestureEndTimer, finishSyntheticGesture])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return
    finishSyntheticGesture(true)
    const contacts = touchTracker.current.begin({
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      altKey: event.altKey,
      ...pointerRatio(event),
    })
    if (!contacts) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    void sendInput({ type: 'touch.update', contacts })
    keyboardRef.current?.focus()
  }, [enabled, finishSyntheticGesture, pointerRatio, sendInput])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!enabled) return
    // The dispatched event already reports the newest position — the last entry of
    // `getCoalescedEvents()` is that same sample, so materialising the array (2-10
    // synthetic PointerEvents per move, ~1000/s at 120Hz) only to read its tail was
    // allocation for nothing. Intermediate samples are deliberately not replayed:
    // the helper's 16ms motion gate would drop them anyway.
    const bounds = (canvas ?? event.currentTarget).getBoundingClientRect()
    const point = normalizeFramePoint(bounds, event.clientX, event.clientY, rotationDegrees)
    lastGestureCenter.current = point
    const contacts = touchTracker.current.move({
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      altKey: event.altKey,
      ...point,
    })
    if (!contacts) return
    scheduleTouchMove(contacts)
  }, [enabled, rotationDegrees, scheduleTouchMove])

  // Not gated on `enabled`: a release has to reach the guest even if the panel went
  // non-interactive mid-gesture, or the device is left holding a stuck contact.
  const endPointer = useCallback((
    event: React.PointerEvent<HTMLElement>,
    phase: 'ended' | 'cancelled',
  ) => {
    const contacts = touchTracker.current.end(event.pointerId, pointerRatio(event), phase)
    if (!contacts) return
    cancelScheduledTouchMove()
    void sendInput({ type: 'touch.update', contacts })
  }, [cancelScheduledTouchMove, pointerRatio, sendInput])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    endPointer(event, 'ended')
  }, [endPointer])

  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLElement>) => {
    endPointer(event, 'cancelled')
  }, [endPointer])

  const onPointerEnter = useCallback((event: React.PointerEvent<HTMLElement>) => {
    lastGestureCenter.current = pointerRatio(event)
  }, [pointerRatio])

  useEffect(() => {
    if (!enabled || !canvas) return

    const onWheel = (event: WheelEvent): void => {
      if (touchTracker.current.pointerCount > 0) return
      const bounds = canvas.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return

      event.preventDefault()
      event.stopPropagation()
      const center = normalizeFramePoint(bounds, event.clientX, event.clientY, rotationDegrees)
      lastGestureCenter.current = center
      keyboardRef.current?.focus()

      const size = unrotateFrameSize(bounds, rotationDegrees)
      const screenDelta = wheelPixels(event, size.height)
      // The wheel reports screen axes; the guest only knows its own. A rotated device
      // that skipped this would scroll sideways when the user scrolled down.
      const delta = rotateFrameDelta(screenDelta.deltaX, screenDelta.deltaY, rotationDegrees)
      const kind = classifyIosSimulatorWheelGesture(event)
      // A physical two-finger twist can produce ordinary wheel deltas alongside
      // BrowserWindow's native rotate-gesture events. Letting those deltas through
      // repeatedly switches the HID contacts between scroll and transform, so the
      // simulated app never observes a coherent rotation.
      if (
        kind === 'scroll'
        && performance.now() < nativeRotationWheelGuardUntil.current
      ) return
      if (kind === 'scroll') {
        dispatchSyntheticFrames(syntheticGesture.current.scroll({ ...delta, center }))
      } else if (kind === 'pinch') {
        dispatchSyntheticFrames(syntheticGesture.current.transform({
          scaleDelta: delta.deltaY,
          rotationDeltaDegrees: 0,
          center,
          aspectRatio: size.width / size.height,
        }))
      } else {
        const dominantDelta = Math.abs(delta.deltaX) > Math.abs(delta.deltaY)
          ? delta.deltaX
          : delta.deltaY
        dispatchSyntheticFrames(syntheticGesture.current.transform({
          scaleDelta: 0,
          rotationDeltaDegrees: -dominantDelta * 0.25,
          center,
          aspectRatio: size.width / size.height,
        }))
      }
      scheduleSyntheticGestureEnd()
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [canvas, dispatchSyntheticFrames, enabled, rotationDegrees, scheduleSyntheticGestureEnd])

  useEffect(() => {
    if (!enabled) return
    const subscribe = window.environment.onIosSimulatorRotateGesture
    if (!subscribe) return
    return subscribe((rotation) => {
      const now = performance.now()
      if (rotation === 0) {
        nativeRotationWheelGuardUntil.current = now + NATIVE_ROTATION_WHEEL_GUARD_MS
        if (syntheticGesture.current.activeMode === 'transform') {
          scheduleSyntheticGestureEnd(60)
        }
        return
      }
      if (touchTracker.current.pointerCount > 0) return
      const shell = shellRef.current
      const isTargeted = canvas?.matches(':hover') === true
        || (shell !== null && shell.contains(document.activeElement))
      if (!isTargeted || !canvas) return

      nativeRotationWheelGuardUntil.current = now + NATIVE_ROTATION_WHEEL_GUARD_MS
      const bounds = canvas.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return
      const size = unrotateFrameSize(bounds, rotationDegrees)
      dispatchSyntheticFrames(syntheticGesture.current.transform({
        scaleDelta: 0,
        rotationDeltaDegrees: rotation,
        center: lastGestureCenter.current,
        aspectRatio: size.width / size.height,
      }))
      scheduleSyntheticGestureEnd()
    })
  }, [canvas, dispatchSyntheticFrames, enabled, rotationDegrees, scheduleSyntheticGestureEnd])

  useEffect(() => () => {
    clearSyntheticGestureEndTimer()
    cancelScheduledTouchMove()
    const hadSyntheticGesture = syntheticGesture.current.cancel() !== null
    if (touchTracker.current.clear() || hadSyntheticGesture) {
      void window.environment.iosSimulatorInput(sessionId, { type: 'touch.cancel' })
    }
  }, [cancelScheduledTouchMove, clearSyntheticGestureEndTimer, enabled, sessionId])

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!enabled) return
    // Mid-composition keystrokes belong to the IME, not the device. Forwarding them
    // types the raw pinyin into iOS and then loses the characters it stood for.
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      finishSyntheticGesture(true)
      cancelScheduledTouchMove()
      if (touchTracker.current.clear()) {
        void sendInput({ type: 'touch.cancel' })
      }
      return
    }
    // Left alone so the browser can raise its own paste event, which is where the
    // host clipboard is actually readable.
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const text = event.key === 'Enter'
      ? '\n'
      : event.key === 'Backspace'
        ? '\b'
        : event.key === 'Tab'
          ? '\t'
          : event.key.length === 1 ? event.key : null
    if (text === null) return
    event.preventDefault()
    void sendInput({ type: 'text', text })
  }, [cancelScheduledTouchMove, enabled, finishSyntheticGesture, sendInput])

  const onCompositionEnd = useCallback((event: React.CompositionEvent<HTMLTextAreaElement>) => {
    if (!enabled || !event.data) return
    // The whole committed string at once. Main routes anything the simulated
    // keyboard cannot spell through the device pasteboard.
    void sendInput({ type: 'text', text: event.data })
  }, [enabled, sendInput])

  const onPaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!enabled) return
    const text = event.clipboardData.getData('text')
    event.preventDefault()
    if (text) void sendInput({ type: 'text', text })
  }, [enabled, sendInput])

  /**
   * The textarea is a keyboard socket, never a document. Everything worth sending has
   * already gone out by the time text lands in it, so this only empties it — left to
   * fill up, the next composition would commit against stale content.
   */
  const onInput = useCallback((event: React.FormEvent<HTMLTextAreaElement>) => {
    event.currentTarget.value = ''
  }, [])

  return {
    shellRef,
    sendInput,
    canvasHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
      onPointerEnter,
    },
    keyboard: {
      ref: keyboardRef,
      handlers: { onKeyDown, onCompositionEnd, onPaste, onInput },
    },
  }
}
