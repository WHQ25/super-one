import type { DeviceUiNode } from '@superone/shared/device-agent'
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

const DEFAULT_MAX_NODES = 500

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
  const maxNodes = Math.max(1, options.maxNodes ?? DEFAULT_MAX_NODES)
  const root: DeviceUiNode = {
    ref: '@e0',
    role: 'screen',
    bounds: [0, 0, 1, 1],
    source: 'ocr',
  }

  const children: DeviceUiNode[] = []
  let dropped = 0
  for (const line of lines) {
    const text = line.text.trim()
    // The box already lives in the space accessibility frames are converted from --
    // upright, top-left origin -- so the existing rotation is reused rather than
    // written a second time. Two copies of a quarter-turn is how one of them ends up
    // 180 degrees out.
    const bounds = text
      ? guestToFramebufferBounds(
        [line.x, line.y, line.width, line.height],
        { width: 1, height: 1 },
        orientation,
      )
      : undefined
    if (!text || !bounds || !(bounds[2] > 0) || !(bounds[3] > 0)) continue
    // Budget counted against the root too, so `maxNodes` means the same number here
    // as it does for an accessibility dump.
    if (children.length + 1 >= maxNodes) { dropped += 1; continue }
    children.push({
      ref: `@e${children.length + 1}`,
      role: 'text',
      label: text,
      bounds,
      source: 'ocr',
    })
  }

  if (children.length) root.children = children
  if (dropped) root.truncatedChildren = dropped

  return {
    root,
    // Empty on purpose: a ref only earns a uid when there is a real accessibility
    // element behind it, and `press` refusing an OCR ref is the correct outcome.
    refs: new Map(),
    screenPoints: { width: 1, height: 1 },
    source: 'ocr',
  }
}
