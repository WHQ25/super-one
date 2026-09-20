import { collectRefs, diffOutlines } from './outline'
import type { StateDiff } from './types'

export function buildDiff(
  before: import('./types').UiOutlineNode,
  after: import('./types').UiOutlineNode,
): StateDiff {
  const d = diffOutlines(before, after)
  // If almost nothing survived unchanged, the content was replaced → full view fallback.
  const larger = Math.max(collectRefs(before).length, collectRefs(after).length)
  const fullViewFallback = larger > 0 && d.stable / larger < 0.2

  return {
    added: d.added,
    removed: d.removed,
    changed: d.changed,
    fullViewFallback,
  }
}
