import { useCallback, useMemo, useRef, type PointerEvent, type RefObject } from 'react'
import { normalizeFramePoint, unrotateFrameSize } from './ios-simulator-input'
import type { IosSimulatorInputApi } from './use-ios-simulator-input'

type CanvasHandlers = IosSimulatorInputApi['canvasHandlers'] & {
  onPointerLeave?: React.PointerEventHandler<HTMLCanvasElement>
}

/** Where the simulated finger is: away, resting on the glass, or pressing it. */
type TouchPointerState = 'idle' | 'hover' | 'press'

export interface IosSimulatorTouchPointerApi {
  ref: RefObject<HTMLDivElement | null>
  /** The input pipeline's canvas handlers with the dot's own tracking folded in. */
  canvasHandlers: CanvasHandlers
}

/**
 * Tracks the host pointer as a finger contact drawn on the device glass.
 *
 * The dot is moved by writing to the DOM node directly rather than through state:
 * a pointer reports at up to 120Hz and this renderer is already decoding the
 * simulator's video stream, so a re-render per sample would spend the frame budget
 * on a circle. Nothing about the dot's position is React's business — it is never
 * read back, only painted.
 */
export function useIosSimulatorTouchPointer({
  enabled,
  rotationDegrees,
  handlers,
}: {
  enabled: boolean
  rotationDegrees: number
  handlers: IosSimulatorInputApi['canvasHandlers']
}): IosSimulatorTouchPointerApi {
  const ref = useRef<HTMLDivElement | null>(null)

  const place = useCallback((event: PointerEvent<HTMLCanvasElement>, state?: TouchPointerState) => {
    const dot = ref.current
    if (!dot) return
    const bounds = event.currentTarget.getBoundingClientRect()
    // Same conversion the touch pipeline runs: the shell is rotated about its own
    // centre, so screen coordinates mean nothing until they are turned back into the
    // device's space — which is also the space this overlay is laid out in.
    const { xRatio, yRatio } = normalizeFramePoint(bounds, event.clientX, event.clientY, rotationDegrees)
    const size = unrotateFrameSize(bounds, rotationDegrees)
    dot.style.transform = `translate3d(${xRatio * size.width}px, ${yRatio * size.height}px, 0)`
    if (state) dot.dataset.state = state
  }, [rotationDegrees])

  const canvasHandlers = useMemo<CanvasHandlers>(() => {
    if (!enabled) return handlers
    return {
      ...handlers,
      onPointerEnter: (event) => { handlers.onPointerEnter(event); place(event, 'hover') },
      // A pointer that arrives already inside — the shell mounting under a resting
      // cursor, or a drag released back over the glass — gets no enter event.
      onPointerMove: (event) => {
        handlers.onPointerMove(event)
        place(event, ref.current?.dataset.state === 'idle' ? 'hover' : undefined)
      },
      onPointerDown: (event) => { handlers.onPointerDown(event); place(event, 'press') },
      onPointerUp: (event) => { handlers.onPointerUp(event); place(event, 'hover') },
      onPointerCancel: (event) => { handlers.onPointerCancel(event); place(event, 'hover') },
      onLostPointerCapture: (event) => { handlers.onLostPointerCapture(event); place(event, 'hover') },
      onPointerLeave: () => {
        // Not `place`: a leave can land outside the glass, and clamping the dot to the
        // edge on the way out draws a finger the user is no longer holding there.
        if (ref.current) ref.current.dataset.state = 'idle'
      },
    }
  }, [enabled, handlers, place])

  return { ref, canvasHandlers }
}

/**
 * The contact itself, mounted inside the device's screen container so the glass
 * clips it exactly the way a finger runs off the edge of a real phone.
 *
 * The outer box spans that container and carries the position; the inner circle is
 * a fixed size, because a fingertip is a fixed size — a dot that grew with the
 * preview would read as a bigger finger rather than a closer device.
 */
export function IosSimulatorTouchPointer({ ref }: { ref: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={ref}
      aria-hidden
      data-ios-touch-pointer=""
      data-state="idle"
      className="group pointer-events-none absolute inset-0"
    >
      <div
        className={
          'absolute left-0 top-0 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full '
          // Light fill with a dark hairline: the guest can be showing anything, and a
          // plain white disc disappears on a white app while a plain dark one
          // disappears on a dark one.
          + 'bg-white/25 opacity-0 shadow-[0_0_0_1px_rgb(0_0_0/0.16),inset_0_0_0_1.5px_rgb(255_255_255/0.6)] '
          + 'transition duration-150 ease-out motion-reduce:transition-none '
          + 'group-data-[state=hover]:opacity-100 '
          + 'group-data-[state=press]:scale-[0.82] group-data-[state=press]:bg-white/45 group-data-[state=press]:opacity-100'
        }
      />
    </div>
  )
}
