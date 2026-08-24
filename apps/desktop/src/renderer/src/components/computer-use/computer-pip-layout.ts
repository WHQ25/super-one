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

const DIMENSIONS: PipDimensions = {
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
  return createDefaultPipLayout(bounds, DIMENSIONS, aspect)
}

export function clampComputerPipLayout(
  layout: PipLayout,
  bounds: PipBounds,
  aspect: number,
): PipLayout {
  return clampPipLayout(layout, bounds, DIMENSIONS, aspect)
}
