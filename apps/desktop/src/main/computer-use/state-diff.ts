import { collectRefs, diffOutlines } from './outline'
import type { StateDiff } from './types'

export function buildDiff(
  before: import('./types').UiOutlineNode,
  after: import('./types').UiOutlineNode,
): StateDiff {
  const d = diffOutlines(before, after)
  const beforeRefs = new Set(collectRefs(before))
  const afterRefs = new Set(collectRefs(after))
  // If almost nothing overlaps, identity is ambiguous → full view fallback.
  let overlap = 0
  for (const r of afterRefs) if (beforeRefs.has(r)) overlap += 1
  const fullViewFallback =
    beforeRefs.size > 0 && afterRefs.size > 0 && overlap / Math.max(beforeRefs.size, afterRefs.size) < 0.2

  return {
    added: d.added,
    removed: d.removed,
    changed: d.changed,
    fullViewFallback,
  }
}
