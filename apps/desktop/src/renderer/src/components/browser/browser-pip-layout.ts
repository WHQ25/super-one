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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function clampBrowserPipLayout(
  layout: BrowserPipLayout,
  bounds: BrowserPipBounds,
): BrowserPipLayout {
  const availableWidth = Math.max(0, bounds.width - BROWSER_PIP_MARGIN * 2)
  const availableHeight = Math.max(0, bounds.height - BROWSER_PIP_MARGIN * 2)
  const maxWidth = Math.min(availableWidth, bounds.width * BROWSER_PIP_MAX_WIDTH_RATIO)
  const minWidth = Math.min(BROWSER_PIP_MIN_WIDTH, maxWidth)
  const minHeight = Math.min(BROWSER_PIP_MIN_HEIGHT, availableHeight)
  const width = clamp(layout.width, minWidth, maxWidth)
  const height = clamp(layout.height, minHeight, availableHeight)
  const minLeft = bounds.left + BROWSER_PIP_MARGIN
  const minTop = bounds.top + BROWSER_PIP_MARGIN
  const maxLeft = bounds.left + bounds.width - BROWSER_PIP_MARGIN - width
  const maxTop = bounds.top + bounds.height - BROWSER_PIP_MARGIN - height

  return {
    left: clamp(layout.left, minLeft, Math.max(minLeft, maxLeft)),
    top: clamp(layout.top, minTop, Math.max(minTop, maxTop)),
    width,
    height,
  }
}

export function createDefaultBrowserPipLayout(bounds: BrowserPipBounds): BrowserPipLayout {
  const width = Math.min(BROWSER_PIP_DEFAULT_WIDTH, bounds.width * BROWSER_PIP_MAX_WIDTH_RATIO)
  const initial = {
    left: bounds.left + bounds.width - BROWSER_PIP_MARGIN - width,
    top: bounds.top + BROWSER_PIP_MARGIN,
    width,
    height: BROWSER_PIP_DEFAULT_HEIGHT,
  }
  return clampBrowserPipLayout(initial, bounds)
}
