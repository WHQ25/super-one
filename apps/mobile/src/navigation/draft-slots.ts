/**
 * Which slot each draft row occupies.
 *
 * Row `n` sits at `n * DRAFT_ROW_HEIGHT`. The group reserves `slots.length`
 * rows, so this decides both what moves and how much space is held. The
 * numbers match the desktop sidebar: a resume reaches the list as two commits
 * (the clicked draft drops, then the composer being left appears). Re-packing
 * on each of those commits shuffles the rows down and back up.
 */

/** A slot held open by a draft that has left but not yet been replaced. */
export const DRAFT_SLOT_HOLE = ''

export function nextDraftSlots(prev: string[], visibleIds: string[], resuming: boolean): string[] {
  if (!resuming) return visibleIds
  const known = new Set(prev)
  // Something arrived — the end state is known, so commit to it in one move.
  if (!visibleIds.every((id) => known.has(id))) return visibleIds
  // Removals only: freeze, leaving the vacated slot empty for whatever lands.
  const visible = new Set(visibleIds)
  return prev.map((id) => (visible.has(id) ? id : DRAFT_SLOT_HOLE))
}
