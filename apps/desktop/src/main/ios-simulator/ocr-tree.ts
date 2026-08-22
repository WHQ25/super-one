import { buildOcrRoot, DEFAULT_OCR_MAX_NODES } from '../device/ocr-nodes'
import type { IosSimulatorOrientation } from '@superone/shared/ios-simulator'
import { guestToFramebufferBounds, type NormalizedAccessibilityTree } from './a11y-tree'

/** One recognized line, as `frame.ocr` emits it. Boxes are upright and normalized. */
export interface IosSimulatorOcrLine {
  text: string
  confidence: number
  /** `[x, y, width, height]` of the UPRIGHT screen, top-left origin, 0-1. */
  x: number
  y: number
  width: number
  height: number
}

export interface OcrToTreeOptions {
  /** Ceiling including the root, matching `accessibility.dump`'s own budget. */
  maxNodes?: number
}


/**
 * Present recognized text as the same tree an accessibility dump produces.
 *
 * The point is that nothing above this line has to learn a second vocabulary. Refs,
 * `device_query`, `textContains`, `device_wait_for` and centre-of-bounds tapping all
 * work against `DeviceUiNode`, so an app with no accessibility tree gets those
 * behaviours for free the moment its pixels can be read — rather than a parallel set
 * of visual-only tools that only some screens support.
 *
 * What it cannot fake is deliberately left absent rather than guessed:
 *
 * - `role` is always `text`. OCR cannot tell a button from a heading, and inferring
 *   one from box size would be wrong often enough to send an agent tapping labels.
 * - `identifier` is missing, so the usual advice ("prefer identifier, it survives
 *   translation") does not apply here — only the visible string exists.
 * - `enabled` / `focused` / hierarchy are unknowable from pixels.
 * - Icon-only controls — a back chevron, a hamburger, a heart — leave no text and so
 *   do not appear at all. This is the real ceiling of the fallback, not a bug in it.
 */
export function ocrToTree(
  lines: readonly IosSimulatorOcrLine[],
  orientation: IosSimulatorOrientation,
  options: OcrToTreeOptions = {},
): NormalizedAccessibilityTree {
  // Rotation first, then the shared node builder. The box already lives in the space
  // accessibility frames are converted from — upright, top-left origin — so the
  // existing rotation is reused rather than written a second time. Two copies of a
  // quarter-turn is how one of them ends up 180 degrees out.
  const entries = lines.flatMap((line) => {
    const bounds = guestToFramebufferBounds(
      [line.x, line.y, line.width, line.height],
      { width: 1, height: 1 },
      orientation,
    )
    // Only a degenerate screen size makes this undefined, and the size is a literal
    // here — the guard exists so the entry type stays honest, not to handle a case.
    return bounds ? [{ text: line.text, bounds }] : []
  })

  return {
    root: buildOcrRoot(entries, options.maxNodes ?? DEFAULT_OCR_MAX_NODES),
    // Empty on purpose: a ref only earns a uid when there is a real accessibility
    // element behind it, and `press` refusing an OCR ref is the correct outcome.
    refs: new Map(),
    screenPoints: { width: 1, height: 1 },
    source: 'ocr',
  }
}
