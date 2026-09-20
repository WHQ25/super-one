import { countComparedNodes, diffOutlines } from './outline'
import type { StateDiff, UiOutlineNode } from './types'

export function buildDiff(before: UiOutlineNode, after: UiOutlineNode): StateDiff {
  const d = diffOutlines(before, after)
  // If almost nothing survived unchanged, the content was replaced → full view
  // fallback. Measured over the nodes the diff compared: the menu bar it
  // leaves out is most of a small window's outline, and counted here it made
  // an unchanged window read as replaced.
  const larger = Math.max(countComparedNodes(before), countComparedNodes(after))
  const fullViewFallback = larger > 0 && d.stable / larger < 0.2

  return {
    added: d.added,
    removed: d.removed,
    changed: d.changed,
    fullViewFallback,
  }
}
