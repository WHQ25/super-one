export interface BrowserPipBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface BrowserPipLayout {
  left: number
  top: number
  width: number
  height: number
}

export const BROWSER_PIP_MARGIN = 12
export const BROWSER_PIP_DEFAULT_WIDTH = 360
export const BROWSER_PIP_DEFAULT_HEIGHT = 240
export const BROWSER_PIP_MIN_WIDTH = 280
export const BROWSER_PIP_MIN_HEIGHT = 200
export const BROWSER_PIP_MAX_WIDTH_RATIO = 0.8
/** Default preview stays compact; user resize can still grow to the chat bounds. */
export const BROWSER_PIP_MAX_HEIGHT_RATIO = 0.45
export const BROWSER_PIP_DEFAULT_MAX_HEIGHT = 360
/** Used when a tab has no panel slot or device emulation yet. Matches the capture fallback. */
export const BROWSER_FALLBACK_VIEWPORT = { width: 1280, height: 800 } as const

export interface ClampBrowserPipOptions {
  maxHeight?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function resolveBrowserPipViewport(
  emulation?: { width: number; height: number } | null,
  panelSlot?: { width: number; height: number } | null,
): { width: number; height: number } {
  if (emulation && emulation.width > 0 && emulation.height > 0) return emulation
  if (panelSlot && panelSlot.width > 0 && panelSlot.height > 0) {
    return { width: panelSlot.width, height: panelSlot.height }
  }
  return BROWSER_FALLBACK_VIEWPORT
}

export function browserPipAspect(viewport: { width: number; height: number }): number {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return BROWSER_FALLBACK_VIEWPORT.width / BROWSER_FALLBACK_VIEWPORT.height
  }
  return viewport.width / viewport.height
}

export function defaultBrowserPipMaxHeight(bounds: BrowserPipBounds): number {
  return Math.min(
    BROWSER_PIP_DEFAULT_MAX_HEIGHT,
    bounds.height * BROWSER_PIP_MAX_HEIGHT_RATIO,
    Math.max(0, bounds.height - BROWSER_PIP_MARGIN * 2),
  )
}

function availablePipBox(bounds: BrowserPipBounds): {
  maxWidth: number
  maxHeight: number
  minWidth: number
  minHeight: number
} {
  const maxWidth = Math.min(
    Math.max(0, bounds.width - BROWSER_PIP_MARGIN * 2),
    bounds.width * BROWSER_PIP_MAX_WIDTH_RATIO,
  )
  const maxHeight = Math.max(0, bounds.height - BROWSER_PIP_MARGIN * 2)
  return {
    maxWidth,
    maxHeight,
    minWidth: Math.min(BROWSER_PIP_MIN_WIDTH, maxWidth),
    minHeight: Math.min(BROWSER_PIP_MIN_HEIGHT, maxHeight),
  }
}

function fitPipSizeToAspect(
  desiredWidth: number,
  aspect: number,
  box: ReturnType<typeof availablePipBox>,
): { width: number; height: number } {
  const { maxWidth, maxHeight, minWidth, minHeight } = box
  let width = Math.min(desiredWidth, maxWidth, maxHeight * aspect)
  if (width < 0 || !Number.isFinite(width)) width = 0
  let height = aspect > 0 ? width / aspect : 0

  if (width < minWidth && minWidth / aspect <= maxHeight) {
    width = minWidth
    height = width / aspect
  }
  if (height < minHeight && minHeight * aspect <= maxWidth) {
    height = minHeight
    width = height * aspect
  }
  return { width, height }
}

export function clampBrowserPipLayout(
  layout: BrowserPipLayout,
  bounds: BrowserPipBounds,
  aspect?: number,
  options?: ClampBrowserPipOptions,
): BrowserPipLayout {
  const box = availablePipBox(bounds)
  if (options?.maxHeight != null) {
    box.maxHeight = Math.min(box.maxHeight, options.maxHeight)
  }
  const sized = aspect && aspect > 0 && Number.isFinite(aspect)
    ? fitPipSizeToAspect(layout.width, aspect, box)
    : {
        width: clamp(layout.width, box.minWidth, box.maxWidth),
        height: clamp(layout.height, box.minHeight, box.maxHeight),
      }
  const minLeft = bounds.left + BROWSER_PIP_MARGIN
  const minTop = bounds.top + BROWSER_PIP_MARGIN
  const maxLeft = bounds.left + bounds.width - BROWSER_PIP_MARGIN - sized.width
  const maxTop = bounds.top + bounds.height - BROWSER_PIP_MARGIN - sized.height

  return {
    left: clamp(layout.left, minLeft, Math.max(minLeft, maxLeft)),
    top: clamp(layout.top, minTop, Math.max(minTop, maxTop)),
    width: sized.width,
    height: sized.height,
  }
}

export function createDefaultBrowserPipLayout(
  bounds: BrowserPipBounds,
  aspect?: number,
): BrowserPipLayout {
  const width = Math.min(BROWSER_PIP_DEFAULT_WIDTH, bounds.width * BROWSER_PIP_MAX_WIDTH_RATIO)
  const initial = {
    left: bounds.left + bounds.width - BROWSER_PIP_MARGIN - width,
    top: bounds.top + BROWSER_PIP_MARGIN,
    width,
    height: aspect && aspect > 0 ? width / aspect : BROWSER_PIP_DEFAULT_HEIGHT,
  }
  return clampBrowserPipLayout(initial, bounds, aspect, {
    maxHeight: defaultBrowserPipMaxHeight(bounds),
  })
}
