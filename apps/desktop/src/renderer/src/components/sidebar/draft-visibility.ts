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

/**
 * How many row slots the group should reserve.
 *
 * Normally just the visible count. While a resume is in flight the count is not
 * trustworthy: the clicked draft leaves the list on click, but the composer the
 * user is leaving only surfaces once the awaited project switch commits — so it
 * dips before it recovers. Latching across that window keeps the project list
 * below perfectly still through a draft→draft hop.
 */
export function nextDraftGroupRows(
  currentRows: number,
  visibleCount: number,
  resumingDraftId: string | null,
): number {
  return resumingDraftId ? currentRows : visibleCount
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
