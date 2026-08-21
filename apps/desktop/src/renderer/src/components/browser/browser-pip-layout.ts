/**
 * The browser preview's numbers. The geometry itself lives in `@/lib/pip-layout`,
 * shared with the iOS Simulator preview — only the sizes below are browser-specific.
 */

import {
  clampPipLayout,
  createDefaultPipLayout,
  defaultPipMaxHeight,
  pipAspectOf,
  type ClampPipOptions,
  type PipBounds,
  type PipDimensions,
  type PipLayout,
} from '@/lib/pip-layout'

export type BrowserPipBounds = PipBounds
export type BrowserPipLayout = PipLayout
export type ClampBrowserPipOptions = ClampPipOptions

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

const BROWSER_PIP_DIMENSIONS: PipDimensions = {
  margin: BROWSER_PIP_MARGIN,
  defaultWidth: BROWSER_PIP_DEFAULT_WIDTH,
  defaultHeight: BROWSER_PIP_DEFAULT_HEIGHT,
  minWidth: BROWSER_PIP_MIN_WIDTH,
  minHeight: BROWSER_PIP_MIN_HEIGHT,
  maxWidthRatio: BROWSER_PIP_MAX_WIDTH_RATIO,
  maxHeightRatio: BROWSER_PIP_MAX_HEIGHT_RATIO,
  defaultMaxHeight: BROWSER_PIP_DEFAULT_MAX_HEIGHT,
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
  return pipAspectOf(viewport, BROWSER_FALLBACK_VIEWPORT.width / BROWSER_FALLBACK_VIEWPORT.height)
}

export function defaultBrowserPipMaxHeight(bounds: BrowserPipBounds): number {
  return defaultPipMaxHeight(bounds, BROWSER_PIP_DIMENSIONS)
}

export function clampBrowserPipLayout(
  layout: BrowserPipLayout,
  bounds: BrowserPipBounds,
  aspect?: number,
  options?: ClampBrowserPipOptions,
): BrowserPipLayout {
  return clampPipLayout(layout, bounds, BROWSER_PIP_DIMENSIONS, aspect, options)
}

export function createDefaultBrowserPipLayout(
  bounds: BrowserPipBounds,
  aspect?: number,
): BrowserPipLayout {
  return createDefaultPipLayout(bounds, BROWSER_PIP_DIMENSIONS, aspect)
}
