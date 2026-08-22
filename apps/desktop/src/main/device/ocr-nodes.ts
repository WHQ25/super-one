/**
 * Recognized text, presented as the tree every layer above already speaks.
 *
 * Shared by the two providers that read pixels: the iOS Simulator, where OCR is a
 * FALLBACK for an app whose accessibility tree is unavailable, and iPhone Mirroring,
 * where it is the ONLY reading there will ever be — the phone arrives as a video
 * stream and accessibility cannot see into it.
 *
 * The reason to share it is not the twenty lines of loop. It is that `ref` numbering,
 * what the node budget counts, and the role/source conventions are a CONTRACT: refs
 * are quoted back by the agent, `press` refuses `source: 'ocr'` on purpose, and
 * `maxNodes` has to mean the same number here as it does for an accessibility dump.
 * Two copies of that drift, and the drift shows up as an agent tapping the wrong row.
 *
 * What OCR cannot fake is left absent rather than guessed:
 *
 * - `role` is always `text`. OCR cannot tell a button from a heading, and inferring
 *   one from box size would be wrong often enough to send an agent tapping labels.
 * - `identifier` is missing, so the usual advice ("prefer identifier, it survives
 *   translation") does not apply — only the visible string exists.
 * - `enabled` / `focused` / hierarchy are unknowable from pixels.
 * - Icon-only controls — a back chevron, a hamburger, a heart — leave no text and so
 *   do not appear at all. That is the real ceiling of reading pixels, not a bug in it.
 */

import type { DeviceUiBounds, DeviceUiNode } from '@superone/shared/device-agent'

/** Ceiling including the root, matching `accessibility.dump`'s own budget. */
export const DEFAULT_OCR_MAX_NODES = 500

/** One line, already converted into the bounds the caller wants it addressed by. */
export interface OcrEntry {
  text: string
  bounds: DeviceUiBounds
}

/**
 * Wrap entries in a screen root.
 *
 * Callers do their own coordinate work first — the simulator has a rotation to undo,
 * the mirror has pixels to normalize — because that step is the one thing genuinely
 * particular to each, and folding both into a single options bag here would put two
 * unrelated coordinate systems in one function.
 *
 * Degenerate entries (blank text, zero-area boxes) are dropped silently rather than
 * counted against the budget: they are noise from the recognizer, and reporting them
 * as truncation would tell the agent the screen was too complex to read.
 */
export function buildOcrRoot(
  entries: readonly OcrEntry[],
  maxNodes: number = DEFAULT_OCR_MAX_NODES,
): DeviceUiNode {
  const budget = Math.max(1, maxNodes)
  const root: DeviceUiNode = {
    ref: '@e0',
    role: 'screen',
    bounds: [0, 0, 1, 1],
    source: 'ocr',
  }

  const children: DeviceUiNode[] = []
  let dropped = 0
  for (const entry of entries) {
    const text = entry.text.trim()
    if (!text || !(entry.bounds[2] > 0) || !(entry.bounds[3] > 0)) continue
    // Counted against the root too, so `maxNodes` means the same number here as it
    // does for an accessibility dump.
    if (children.length + 1 >= budget) { dropped += 1; continue }
    children.push({
      ref: `@e${children.length + 1}`,
      role: 'text',
      label: text,
      bounds: entry.bounds,
      source: 'ocr',
    })
  }

  if (children.length) root.children = children
  if (dropped) root.truncatedChildren = dropped
  return root
}
