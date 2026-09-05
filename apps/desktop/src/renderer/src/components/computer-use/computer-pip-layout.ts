import {
  clampPipLayout,
  createDefaultPipLayout,
  pipAspectOf,
  type PipBounds,
  type PipDimensions,
  type PipLayout,
} from '@/lib/pip-layout'

export const COMPUTER_PIP_DEFAULT_WIDTH = 200
export const COMPUTER_PIP_MIN_WIDTH = 200
export const COMPUTER_PIP_MIN_CAPTURE_EDGE = 480
export const COMPUTER_PIP_MAX_CAPTURE_EDGE = 1440

export const COMPUTER_PIP_DIMENSIONS: PipDimensions = {
  margin: 12,
  defaultWidth: COMPUTER_PIP_DEFAULT_WIDTH,
  defaultHeight: 120,
  minWidth: COMPUTER_PIP_MIN_WIDTH,
  minHeight: 120,
  maxWidthRatio: 0.8,
  maxHeightRatio: 0.45,
  defaultMaxHeight: 360,
}

export function computerPipAspect(source?: { width: number; height: number } | null): number {
  return pipAspectOf(source ?? { width: 0, height: 0 }, 3 / 2)
}

export function createDefaultComputerPipLayout(bounds: PipBounds, aspect: number): PipLayout {
  return createDefaultPipLayout(bounds, COMPUTER_PIP_DIMENSIONS, aspect)
}

export function clampComputerPipLayout(
  layout: PipLayout,
  bounds: PipBounds,
  aspect: number,
): PipLayout {
  return clampPipLayout(layout, bounds, COMPUTER_PIP_DIMENSIONS, aspect)
}

export function computerPipCaptureSize(
  layout: Pick<PipLayout, 'width' | 'height'>,
  devicePixelRatio: number,
): { width: number; height: number } {
  const pixelRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1
  const rawWidth = Math.max(1, layout.width * pixelRatio)
  const rawHeight = Math.max(1, layout.height * pixelRatio)
  const longEdge = Math.max(rawWidth, rawHeight)
  const targetLongEdge = Math.min(
    COMPUTER_PIP_MAX_CAPTURE_EDGE,
    Math.max(COMPUTER_PIP_MIN_CAPTURE_EDGE, longEdge),
  )
  const scale = targetLongEdge / longEdge
  return {
    width: Math.max(1, Math.round(rawWidth * scale)),
    height: Math.max(1, Math.round(rawHeight * scale)),
  }
}
