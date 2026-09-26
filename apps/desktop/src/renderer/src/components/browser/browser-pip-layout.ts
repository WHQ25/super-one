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
export const BROWSER_PIP_DEFAULT_WIDTH = 200
export const BROWSER_PIP_DEFAULT_HEIGHT = 112.5
export const BROWSER_PIP_MIN_WIDTH = 200
export const BROWSER_PIP_MIN_HEIGHT = 100
export const BROWSER_PIP_MAX_WIDTH_RATIO = 0.8
/** Default preview stays compact; user resize can still grow to the chat bounds. */
export const BROWSER_PIP_MAX_HEIGHT_RATIO = 0.45
export const BROWSER_PIP_DEFAULT_MAX_HEIGHT = 360
/** Used when display dimensions are unavailable. Matches the capture fallback. */
export const BROWSER_FALLBACK_VIEWPORT = { width: 1280, height: 800 } as const

const MAXIMIZED_CARD_INSET = 5
const MAXIMIZED_CARD_BORDER = 1
const ACTIVITY_TAB_HEADER_HEIGHT = 34
const WINDOWS_TITLE_BAR_HEIGHT = 40

export const BROWSER_PIP_DIMENSIONS: PipDimensions = {
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
  display?: { availWidth: number; availHeight: number } | null,
  platform?: string,
): { width: number; height: number } {
  if (emulation && emulation.width > 0 && emulation.height > 0) return emulation
  if (display && display.availWidth > 0 && display.availHeight > 0) {
    // A maximized browser tab folds the sidebar and chat. Use that content area
    // for both the PiP frame and its webview, independently of the panel's width.
    const width = display.availWidth - 2 * (MAXIMIZED_CARD_INSET + MAXIMIZED_CARD_BORDER)
    const height = display.availHeight
      - (platform === 'win32' ? WINDOWS_TITLE_BAR_HEIGHT : MAXIMIZED_CARD_INSET)
      - MAXIMIZED_CARD_INSET - 2 * MAXIMIZED_CARD_BORDER - ACTIVITY_TAB_HEADER_HEIGHT
    if (width > 0 && height > 0) return { width, height }
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
