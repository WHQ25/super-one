/**
 * The simulator preview's numbers. Geometry lives in `@/lib/pip-layout`.
 *
 * Sized very differently from the browser preview: a phone is tall and narrow, so the
 * width floor has to be small enough that a portrait box at that width still fits the
 * chat vertically — a 280px floor borrowed from the browser would demand ~560px of
 * height and get clamped into a shape no phone has.
 */

import type { IosSimulatorChrome } from '@superone/shared/ios-simulator'
import {
  clampPipLayout,
  createDefaultPipLayout,
  defaultPipMaxHeight,
  pipAspectOf,
  type PipBounds,
  type PipDimensions,
  type PipLayout,
} from '@/lib/pip-layout'
import { iosSimulatorOuterBox } from './ios/ios-simulator-chrome-layout'

/**
 * The glass of an iPhone 17 Pro Max (1320 x 2868), for a device that has not reported
 * its framebuffer yet.
 *
 * A fallback only. The preview draws the device and nothing else, so the box has to
 * be the device's own shape — a nominal ratio would letterbox a real phone inside a
 * box the user is dragging by its empty corners.
 */
export const DEVICE_PIP_ASPECT = 1320 / 2868

const DEVICE_PIP_DIMENSIONS: PipDimensions = {
  margin: 12,
  defaultWidth: 220,
  defaultHeight: 440,
  minWidth: 130,
  minHeight: 200,
  maxWidthRatio: 0.6,
  maxHeightRatio: 0.8,
  defaultMaxHeight: 520,
}

/**
 * The shape the preview box should take: the DEVICE as it is drawn, not its glass.
 *
 * Apple's artwork is the thing in the box, and it is wider than the screen it frames —
 * an iPhone 17 Pro Max is a 440x956pt screen inside a 494x992pt body once the 18pt
 * bezel and the 9pt the side buttons stick out into are counted. Sizing the box off
 * the framebuffer instead leaves the device fitting to width and floating in ~8% of
 * dead height, which reads as a top margin twice the size of the side one.
 *
 * `viewport` is passed already turned — the framebuffer never changes shape, the guest
 * draws its rotated UI into the same portrait surface, so only the caller knows which
 * way the device is lying. The body follows it: a landscape guest is a landscape body.
 *
 * No chrome means no artwork for this model, and `DeviceBareScreen` draws the
 * glass alone — for which the framebuffer's own shape is exactly right.
 */
export function devicePipAspect(
  viewport: { width: number; height: number } | null | undefined,
  chrome?: IosSimulatorChrome | null,
): number {
  const screen = pipAspectOf(viewport ?? { width: 0, height: 0 }, DEVICE_PIP_ASPECT)
  if (!chrome) return screen
  const box = iosSimulatorOuterBox(chrome)
  if (!(box.width > 0) || !(box.height > 0)) return screen
  const upright = box.width / box.height
  return screen > 1 ? 1 / upright : upright
}

export function defaultDevicePipMaxHeight(bounds: PipBounds): number {
  return defaultPipMaxHeight(bounds, DEVICE_PIP_DIMENSIONS)
}

export function clampDevicePipLayout(
  layout: PipLayout,
  bounds: PipBounds,
  aspect: number = DEVICE_PIP_ASPECT,
  options?: { maxHeight?: number },
): PipLayout {
  return clampPipLayout(layout, bounds, DEVICE_PIP_DIMENSIONS, aspect, options)
}

export function createDefaultDevicePipLayout(
  bounds: PipBounds,
  aspect: number = DEVICE_PIP_ASPECT,
): PipLayout {
  return createDefaultPipLayout(bounds, DEVICE_PIP_DIMENSIONS, aspect)
}
