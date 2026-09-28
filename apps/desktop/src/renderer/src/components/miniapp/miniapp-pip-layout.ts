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

/**
 * The size the view keeps inside the preview: an emulated viewport, its dock slot,
 * which stays laid out while the Activity panel is closed, or the panel's width
 * until it has one.
 */
export function miniAppPipViewport(
  panelSlot: { width: number; height: number } | undefined,
  panelWidth: number,
  emulation?: { width: number; height: number },
): { width: number; height: number } {
  if (emulation && emulation.width > 0 && emulation.height > 0) return { width: emulation.width, height: emulation.height }
  if (panelSlot && panelSlot.width > 0 && panelSlot.height > 0) return { width: panelSlot.width, height: panelSlot.height }
  return { width: panelWidth, height: FALLBACK_VIEWPORT_HEIGHT }
}

export function miniAppPipAspect(viewport: { width: number; height: number }): number {
  return pipAspectOf(viewport, 9 / 16)
}
