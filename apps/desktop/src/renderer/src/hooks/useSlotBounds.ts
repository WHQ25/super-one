import { useLayoutEffect, useRef, type RefObject } from 'react'

interface RoundedBounds {
  left: number
  top: number
  width: number
  height: number
}

const STABLE_FRAMES_TO_STOP = 2
const GEOMETRY_TRANSITION_PROPERTIES = new Set([
  'width',
  'height',
  'left',
  'right',
  'top',
  'bottom',
  'transform',
  'flex-basis',
  'grid-template-columns',
  'grid-template-rows',
  'margin-left',
  'margin-right',
  'margin-top',
  'margin-bottom',
])

function roundedBounds(rect: DOMRectReadOnly): RoundedBounds {
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

function sameBounds(a: RoundedBounds | null, b: RoundedBounds): boolean {
  return (
    a != null &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  )
}

/** Tracks a persistent host slot without keeping the renderer on a permanent rAF loop. */
export function useSlotBounds(
  ref: RefObject<HTMLElement | null>,
  trackingKey: string,
  onBounds: (rect: DOMRectReadOnly) => void,
  onUnregister: () => void,
  continuous = false,
): void {
  const onBoundsRef = useRef(onBounds)
  const onUnregisterRef = useRef(onUnregister)
  const continuousRef = useRef(continuous)
  const scheduleRef = useRef<() => void>(() => {})
  onBoundsRef.current = onBounds
  onUnregisterRef.current = onUnregister
  continuousRef.current = continuous

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const unregister = onUnregisterRef.current
    let rafId = 0
    let stableFrames = 0
    let activeTransitions = 0
    let lastBounds: RoundedBounds | null = null

    const frame = () => {
      rafId = 0
      if (document.hidden) return

      const rect = el.getBoundingClientRect()
      const nextBounds = roundedBounds(rect)
      if (sameBounds(lastBounds, nextBounds)) {
        stableFrames += 1
      } else {
        lastBounds = nextBounds
        stableFrames = 0
        onBoundsRef.current(rect)
      }

      if (
        continuousRef.current ||
        activeTransitions > 0 ||
        stableFrames < STABLE_FRAMES_TO_STOP
      ) {
        rafId = requestAnimationFrame(frame)
      }
    }

    const schedule = () => {
      stableFrames = 0
      if (!rafId && !document.hidden) rafId = requestAnimationFrame(frame)
    }
    scheduleRef.current = schedule

    const onTransitionStart = (event: TransitionEvent) => {
      if (!GEOMETRY_TRANSITION_PROPERTIES.has(event.propertyName)) return
      activeTransitions += 1
      schedule()
    }
    const onTransitionEnd = (event: TransitionEvent) => {
      if (!GEOMETRY_TRANSITION_PROPERTIES.has(event.propertyName)) return
      activeTransitions = Math.max(0, activeTransitions - 1)
      schedule()
    }
    const onVisibilityChange = () => {
      if (!document.hidden) schedule()
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    schedule()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('transitionstart', onTransitionStart, true)
    window.addEventListener('transitionend', onTransitionEnd, true)
    window.addEventListener('transitioncancel', onTransitionEnd, true)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      scheduleRef.current = () => {}
      if (rafId) cancelAnimationFrame(rafId)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('transitionstart', onTransitionStart, true)
      window.removeEventListener('transitionend', onTransitionEnd, true)
      window.removeEventListener('transitioncancel', onTransitionEnd, true)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unregister()
    }
  }, [ref, trackingKey])

  useLayoutEffect(() => {
    if (continuous) scheduleRef.current()
  }, [continuous])
}
