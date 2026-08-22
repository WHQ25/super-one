/**
 * What the agent gets to read on a mirrored iPhone.
 *
 * Thin on purpose — the node conventions live in `device/ocr-nodes.ts`, shared with
 * the simulator's OCR fallback. All that is particular here is the coordinate space:
 * Vision reports boxes in the capture's own pixels, and `DeviceUiNode.bounds` is
 * normalized 0–1, so the only work is a divide.
 *
 * No rotation step, and that absence is load-bearing. A simulator draws a rotated UI
 * into a fixed-shape framebuffer, so its OCR boxes have to be turned back upright. The
 * mirroring window is re-shaped by macOS when the phone turns — a landscape phone
 * gives a landscape window — so what is captured is already upright and rotating it
 * would put every box a quarter-turn out.
 */

import type { DeviceUiNode } from '@superone/shared/device-agent'
import { buildOcrRoot, DEFAULT_OCR_MAX_NODES, type OcrEntry } from '../ocr-nodes'
import type { MirrorText } from './mirror-helper'

/**
 * Recognized text as a screen tree.
 *
 * `size` is the capture's pixel size, which is what Vision measured against. Passing
 * the WINDOW's point size instead would scale every box by the display's backing
 * factor — a Retina Mac would put all of them in the top-left quadrant.
 */
export function mirrorTextToTree(
  texts: readonly MirrorText[],
  size: { width: number; height: number },
  maxNodes: number = DEFAULT_OCR_MAX_NODES,
): DeviceUiNode {
  if (!(size.width > 0) || !(size.height > 0)) return buildOcrRoot([], maxNodes)
  const entries: OcrEntry[] = texts.map((line) => ({
    text: line.text,
    bounds: [
      line.x / size.width,
      line.y / size.height,
      line.width / size.width,
      line.height / size.height,
    ],
  }))
  return buildOcrRoot(entries, maxNodes)
}

/**
 * Turn a node's box back into a point in the capture, for tapping.
 *
 * The centre, always. An OCR node has no accessibility element behind it, so there is
 * nothing to press — the only thing that can be done with one is to touch the middle
 * of the rectangle its text was found in.
 */
export function mirrorNodeCentre(
  node: DeviceUiNode,
  size: { width: number; height: number },
): { x: number; y: number } | null {
  const bounds = node.bounds
  if (!bounds) return null
  return {
    x: (bounds[0] + bounds[2] / 2) * size.width,
    y: (bounds[1] + bounds[3] / 2) * size.height,
  }
}
