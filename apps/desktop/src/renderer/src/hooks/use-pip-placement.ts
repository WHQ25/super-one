/**
 * Where a floating preview sits — and how it survives a boundary that lies.
 *
 * Every preview (browser, device, computer use) used to keep one already-clamped
 * rect as its state, which broke in two ways that show up together when the user
 * switches sessions:
 *
 * 1. `clampPipLayout` only ever pushes a box further INTO its boundary; it can never
 *    push it back out. So a single measurement of a boundary that is momentarily
 *    wrong rewrites the position permanently. Switching sessions is exactly that
 *    moment: the Activity panel is per-session and its width is animated, so the
 *    first measurement after the switch is of a chat far narrower than the one the
 *    user ends up looking at — and the preview stays parked at the top-left of a box
 *    that no longer exists. A `display:none` chat root, which measures 0x0, is the
 *    same failure with the extremes turned up.
 * 2. One rect for every preview meant a switch handed the next preview the previous
 *    one's coordinates, and coming back had nothing to come back to.
 *
 * So this hook keeps the position the user CHOSE, per preview identity, and clamps
 * only the copy it hands back for drawing. A transient boundary can move the drawn
 * box; it cannot overwrite where the box belongs. Until the user has placed it the
 * preview is `pristine` and re-derives its default on every measurement, which is
 * what keeps a fresh preview pinned to the top-right corner while the chat settles.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  clampPipLayout,
  createDefaultPipLayout,
  defaultPipMaxHeight,
  type PipBounds,
  type PipDimensions,
  type PipLayout,
} from '@/lib/pip-layout'

export interface PipPlacementOptions {
  /**
   * What is being previewed — a browser tab, a device tab, a captured window. A new
   * identity opens at the default corner; a returning one comes back where it was
   * left. `null` while nothing is bound.
   */
  key: string | null
  /** On screen. Measurement runs only while it is; the position outlives it. */
  active: boolean
  aspect: number
  dims: PipDimensions
}

export interface PipPlacement {
  /** The chat area the preview is pinned inside, for drag/resize to clamp against. */
  bounds: PipBounds | null
  /** Fitted to the boundary as it is right now — what to draw. */
  layout: PipLayout | null
  /** Record a position the user chose, in the coordinates they chose it in. */
  setLayout: (next: PipLayout) => void
}

interface PlacementState {
  key: string | null
  /** The wanted position, NOT clamped — clamping happens per frame, on the way out. */
  layout: PipLayout | null
  /** Never dragged or resized, so its default may still be re-derived. */
  pristine: boolean
  /** Positions the user chose, per identity, so a switch away is not a loss. */
  placed: Record<string, PipLayout>
}

/**
 * The chat the user is looking at.
 *
 * `data-chat-root` is not unique: a side chat in the Activity panel carries one and
 * sits EARLIER in the document, and a mosaic tile carries one per tile. Preferring
 * the main area keeps a hidden sibling — which measures 0x0 — from being mistaken
 * for the chat. The bare fallback covers the mini window, which has no main area.
 */
function pipBoundary(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-main-area] [data-chat-root]')
    ?? document.querySelector<HTMLElement>('[data-chat-root]')
}

export function usePipPlacement({ key, active, aspect, dims }: PipPlacementOptions): PipPlacement {
  const [bounds, setBounds] = useState<PipBounds | null>(null)
  const [state, setState] = useState<PlacementState>(
    () => ({ key, layout: null, pristine: true, placed: {} }),
  )
  const aspectRef = useRef(aspect)

  // Adjusted during render, not in an effect: a preview must never paint even one
  // frame at the previous target's coordinates.
  if (state.key !== key) setState(switchPlacementKey(state, key))

  useLayoutEffect(() => {
    if (!active || key == null) return
    const boundary = pipBoundary()
    if (!boundary) return

    const measure = (): void => {
      const rect = boundary.getBoundingClientRect()
      // A collapsed boundary is not information: a panel still animating open, or a
      // chat root that is display:none. Fitting into it would move the preview
      // somewhere the later, correct measurement can never bring it back from.
      if (!(rect.width > 0) || !(rect.height > 0)) return
      const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      // A device turning on its side is a new shape, not a new size. Re-fitting it
      // under the DEFAULT height ceiling is what keeps a landscape box from
      // inheriting a portrait one's height and spanning the whole chat.
      const turned = aspectRef.current !== aspect
      aspectRef.current = aspect
      setBounds(next)
      setState((current) => {
        if (current.key !== key) return current
        if (current.pristine || !current.layout) {
          const fresh = createDefaultPipLayout(next, dims, aspect)
          return samePipLayout(current.layout, fresh) ? current : { ...current, layout: fresh }
        }
        if (!turned) return current
        return {
          ...current,
          layout: clampPipLayout(current.layout, next, dims, aspect, {
            maxHeight: defaultPipMaxHeight(next, dims),
          }),
        }
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(boundary)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [active, aspect, dims, key])

  const setLayout = useCallback((next: PipLayout) => {
    setState((current) => (!current.pristine && samePipLayout(current.layout, next)
      ? current
      : { ...current, layout: next, pristine: false }))
  }, [])

  const layout = useMemo(
    () => (bounds && state.layout ? clampPipLayout(state.layout, bounds, dims, aspect) : null),
    [aspect, bounds, dims, state.layout],
  )

  return { bounds, layout, setLayout }
}

/** Bank what the user chose for the outgoing preview, take back the incoming one's. */
function switchPlacementKey(state: PlacementState, key: string | null): PlacementState {
  const placed = state.key != null && state.layout && !state.pristine
    ? { ...state.placed, [state.key]: state.layout }
    : state.placed
  const restored = key != null ? placed[key] ?? null : null
  return { key, layout: restored, pristine: restored == null, placed }
}

function samePipLayout(a: PipLayout | null, b: PipLayout): boolean {
  return a != null
    && a.left === b.left && a.top === b.top
    && a.width === b.width && a.height === b.height
}
