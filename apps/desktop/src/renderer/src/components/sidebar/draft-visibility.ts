/**
 * Which drafts the sidebar shows as rows.
 *
 * Extracted from `DraftsSection` because the answer decides an animation: the
 * group's height follows the row count, so a draft that flickers in and out of
 * this list makes the whole project list below it shudder.
 */

import type { DraftListEntry } from '@superone/shared/environment'
import { isDraftOwnedBySession } from '@/stores/chat-store/helpers/draft-promote'

export interface DraftVisibilityContext {
  /** Session currently focused — its own draft is being edited, not listed. */
  activeSessionId: string | null
  /** Draft id stamped on that session, when the origin map has been lost. */
  activeDraftId: string | null
  /** Draft the user clicked; ownership only lands after an awaited switch. */
  resumingDraftId: string | null
}

/** A slot held open by a draft that has left but not yet been replaced. */
export const DRAFT_SLOT_HOLE = ''

/**
 * Which slot each row occupies. Row `n` sits at `n * DRAFT_ROW_HEIGHT`, and the
 * group reserves `slots.length` rows, so this decides both what moves and how
 * much space is held.
 *
 * A resume reaches the sidebar as two separate commits: the clicked draft drops
 * out on click, and the composer being left behind only appears once the awaited
 * project switch lands. Re-deriving slots from each of those commits makes rows
 * shuffle to fill the gap and then shuffle back — so hold every surviving row
 * exactly where it is until the arriving draft tells us the final layout, then
 * move to it once. Rows whose slot is unchanged by that move never animate.
 */
export function nextDraftSlots(
  prev: string[],
  visibleIds: string[],
  resuming: boolean,
): string[] {
  if (!resuming) return visibleIds
  const known = new Set(prev)
  // Something arrived — the end state is known, so commit to it in one move.
  if (!visibleIds.every((id) => known.has(id))) return visibleIds
  // Removals only: freeze, leaving the vacated slot empty for whatever lands.
  const visible = new Set(visibleIds)
  return prev.map((id) => (visible.has(id) ? id : DRAFT_SLOT_HOLE))
}

export function selectVisibleDrafts(
  drafts: DraftListEntry[] | undefined,
  ctx: DraftVisibilityContext,
): DraftListEntry[] {
  if (!drafts?.length) return []
  return drafts.filter(
    (d) =>
      d.id !== ctx.resumingDraftId
      && !isDraftOwnedBySession(d, ctx.activeSessionId, ctx.activeDraftId),
  )
}
