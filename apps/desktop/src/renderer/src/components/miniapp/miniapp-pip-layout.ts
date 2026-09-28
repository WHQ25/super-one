import { pipAspectOf, type PipDimensions } from '@/lib/pip-layout'

/**
 * The mini-app preview's numbers. A mini-app is laid out for the Activity panel,
 * so the preview is portrait and keeps the panel's viewport, scaled down.
 */
export const MINIAPP_PIP_DIMENSIONS: PipDimensions = {
  margin: 12,
  defaultWidth: 180,
  defaultHeight: 280,
  minWidth: 140,
  minHeight: 160,
  maxWidthRatio: 0.6,
  maxHeightRatio: 0.7,
  defaultMaxHeight: 360,
}

const FALLBACK_VIEWPORT_HEIGHT = 720
const ACTIVITY_TAB_HEADER_HEIGHT = 34

/**
 * The size the view keeps inside the preview: explicit emulation, or the
 * activity panel's full content area. A split dock slot must not change the
 * preview's aspect or the mini-app viewport while the panel is closed.
 */
export function miniAppPipViewport(
  panelWidth: number,
  panelHeight: number | undefined,
  emulation?: { width: number; height: number },
): { width: number; height: number } {
  if (emulation && emulation.width > 0 && emulation.height > 0) return { width: emulation.width, height: emulation.height }
  const height = panelHeight && panelHeight > ACTIVITY_TAB_HEADER_HEIGHT
    ? panelHeight - ACTIVITY_TAB_HEADER_HEIGHT
    : FALLBACK_VIEWPORT_HEIGHT
  return { width: panelWidth, height }
}

export function miniAppPipAspect(viewport: { width: number; height: number }): number {
  return pipAspectOf(viewport, 9 / 16)
}
