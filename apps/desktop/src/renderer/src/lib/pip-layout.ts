/**
 * Geometry for a floating, aspect-locked preview pinned inside a boundary element.
 *
 * Lifted out of the browser preview so the iOS Simulator preview can be the same
 * object rather than a second copy of the same clamping bugs — the two differ only in
 * how big the box wants to be, which is what `PipDimensions` carries. All of it is
 * pure: no DOM, no store, so both callers can unit-test their own numbers.
 */

export interface PipBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface PipLayout {
  left: number
  top: number
  width: number
  height: number
}

/** How big this particular preview wants to be, relative to its boundary. */
export interface PipDimensions {
  margin: number
  defaultWidth: number
  defaultHeight: number
  minWidth: number
  minHeight: number
  maxWidthRatio: number
  /** Ceiling applied only to the *default* size; a user resize may exceed it. */
  maxHeightRatio: number
  defaultMaxHeight: number
}

export interface ClampPipOptions {
  maxHeight?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function pipAspectOf(viewport: { width: number; height: number }, fallback: number): number {
  if (viewport.width <= 0 || viewport.height <= 0) return fallback
  return viewport.width / viewport.height
}

export function defaultPipMaxHeight(bounds: PipBounds, dims: PipDimensions): number {
  return Math.min(
    dims.defaultMaxHeight,
    bounds.height * dims.maxHeightRatio,
    Math.max(0, bounds.height - dims.margin * 2),
  )
}

function availablePipBox(bounds: PipBounds, dims: PipDimensions): {
  maxWidth: number
  maxHeight: number
  minWidth: number
  minHeight: number
} {
  const maxWidth = Math.min(
    Math.max(0, bounds.width - dims.margin * 2),
    bounds.width * dims.maxWidthRatio,
  )
  const maxHeight = Math.max(0, bounds.height - dims.margin * 2)
  return {
    maxWidth,
    maxHeight,
    minWidth: Math.min(dims.minWidth, maxWidth),
    minHeight: Math.min(dims.minHeight, maxHeight),
  }
}

function fitPipSizeToAspect(
  desiredWidth: number,
  aspect: number,
  box: ReturnType<typeof availablePipBox>,
): { width: number; height: number } {
  const { maxWidth, maxHeight, minWidth } = box
  let width = Math.min(desiredWidth, maxWidth, maxHeight * aspect)
  if (width < 0 || !Number.isFinite(width)) width = 0
  let height = aspect > 0 ? width / aspect : 0

  if (width < minWidth && minWidth / aspect <= maxHeight) {
    width = minWidth
    height = width / aspect
  }
  return { width, height }
}

export function clampPipLayout(
  layout: PipLayout,
  bounds: PipBounds,
  dims: PipDimensions,
  aspect?: number,
  options?: ClampPipOptions,
): PipLayout {
  const box = availablePipBox(bounds, dims)
  if (options?.maxHeight != null) {
    // A compact default ceiling must never undercut the advertised width floor when
    // the chat itself has room. Portrait targets may need more height to remain 160px
    // wide; only the physical boundary is allowed to force them below that minimum.
    const minAspectHeight = aspect && aspect > 0 ? box.minWidth / aspect : 0
    box.maxHeight = Math.min(box.maxHeight, Math.max(options.maxHeight, minAspectHeight))
  }
  const sized = aspect && aspect > 0 && Number.isFinite(aspect)
    ? fitPipSizeToAspect(layout.width, aspect, box)
    : {
        width: clamp(layout.width, box.minWidth, box.maxWidth),
        height: clamp(layout.height, box.minHeight, box.maxHeight),
      }
  const minLeft = bounds.left + dims.margin
  const minTop = bounds.top + dims.margin
  const maxLeft = bounds.left + bounds.width - dims.margin - sized.width
  const maxTop = bounds.top + bounds.height - dims.margin - sized.height

  return {
    left: clamp(layout.left, minLeft, Math.max(minLeft, maxLeft)),
    top: clamp(layout.top, minTop, Math.max(minTop, maxTop)),
    width: sized.width,
    height: sized.height,
  }
}

export function createDefaultPipLayout(
  bounds: PipBounds,
  dims: PipDimensions,
  aspect?: number,
): PipLayout {
  const width = Math.min(dims.defaultWidth, bounds.width * dims.maxWidthRatio)
  const initial = {
    left: bounds.left + bounds.width - dims.margin - width,
    top: bounds.top + dims.margin,
    width,
    height: aspect && aspect > 0 ? width / aspect : dims.defaultHeight,
  }
  return clampPipLayout(initial, bounds, dims, aspect, {
    // The initial width is a contract too. Raise the compact height ceiling when a
    // portrait aspect needs it, while clampPipLayout still respects physical bounds.
    maxHeight: Math.max(defaultPipMaxHeight(bounds, dims), initial.height),
  })
}
