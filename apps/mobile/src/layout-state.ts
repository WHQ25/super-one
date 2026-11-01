export const TABLET_SPLIT_MIN_WIDTH = 768

/** Resident workspace pane on a tablet, and on a Duo held as a book. */
export const SIDEBAR_PANE_WIDTH = 280

/**
 * How far a Duo sidebar sits off the glass.
 *
 * The inner panel's window insets are the wrong size for this column: in
 * portrait the clock lives in the top-right corner, so a full top inset leaves
 * the sidebar and the left of that band blank, and in landscape the bottom
 * inset leaves a band under the composer. Content keeps a short margin; the
 * pane background runs to the edge.
 */
export const FOLD_CONTENT_INSET = 10

/**
 * Bottom clearance on Duo glass. The home-indicator inset leaves the composer
 * high on both the inner panel and the folded cover.
 */
export function foldGlassBottomInset(bottom: number): number {
  return Math.min(Math.max(bottom, 0), FOLD_CONTENT_INSET)
}

/**
 * Portrait inner panel only. The status cluster (clock and radio) occupies
 * about 134pt of the top-right corner. The session header shares that band,
 * and this padding — outside the header's own 8pt — keeps the trailing
 * control to the left of the cluster.
 */
export const FOLD_PORTRAIT_STATUS_TRAILING = 136

/**
 * iPhone Duo inner panel, in points (2007×2853 px at 3×). Either orientation.
 * The cover is 466×678, so it never matches. A slack of 16pt absorbs a
 * rounded window without catching an iPad.
 */
const DUO_INNER_SHORT = 669
const DUO_INNER_LONG = 951
const DUO_INNER_SLACK = 16

/** Hinge reading from `UIHinge`. `unknown` is a phone, a tablet, or a binary without the probe. */
export type HingePosture = 'unknown' | 'closed' | 'partial' | 'flat'

export function isInnerFoldableWindow(width: number, height: number): boolean {
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  return Math.abs(short - DUO_INNER_SHORT) <= DUO_INNER_SLACK
    && Math.abs(long - DUO_INNER_LONG) <= DUO_INNER_SLACK
}

/**
 * iPhone Duo cover, in points (1398×2034 px at 3×). Either orientation.
 * Both axes have to match. A height cutoff would also catch the landscape
 * book, which is 669 pt tall. Phones and the inner panel stay outside it.
 */
const DUO_COVER_SHORT = 466
const DUO_COVER_LONG = 678

export function isFoldedCoverWindow(width: number, height: number): boolean {
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  return Math.abs(short - DUO_COVER_SHORT) <= DUO_INNER_SLACK
    && Math.abs(long - DUO_COVER_LONG) <= DUO_INNER_SLACK
}

/**
 * Width of the resident sidebar, or null when the shell stays a single pane
 * and the workspace is a drawer.
 *
 * Portrait on the inner panel stays a phone: the workspace is a drawer, not a
 * column beside the session. Held landscape — the book — it keeps the 280pt
 * pane when the hinge is flat or not yet known. A partial hinge in that pose
 * sizes the pane to one leaf so the crease sits between the sidebar and the
 * session. A portrait crease runs across the height, which a side pane cannot
 * take, so that pose stays a drawer too.
 */
export function workspaceSidebarWidth(
  width: number,
  height: number,
  hinge: HingePosture = 'unknown',
): number | null {
  if (isInnerFoldableWindow(width, height)) {
    if (height > width) return null
    if (hinge === 'partial') return Math.round(width / 2)
    return SIDEBAR_PANE_WIDTH
  }
  if (width >= TABLET_SPLIT_MIN_WIDTH) return SIDEBAR_PANE_WIDTH
  return null
}

/**
 * Vertical padding for the Duo shell once the root safe area no longer supplies it.
 *
 * `portrait` is the inner panel held as a column. The clock then sits in the
 * corner, so a session header may rise into the band (`headerLift`) and only
 * its trailing control keeps clear (`headerTrailing`). The landscape book
 * keeps the full top inset: the clock spans the session there. `detailTop`
 * stays the full inset either way, for screens that draw no header.
 */
export function foldableContentInsets(
  insets: { top: number; bottom: number },
  portrait = false,
): {
  sidebar: number
  detailTop: number
  detailBottom: number
  headerLift: number
  headerTrailing: number
} {
  const headerLift = portrait && insets.top > FOLD_CONTENT_INSET ? insets.top - FOLD_CONTENT_INSET : 0
  return {
    sidebar: FOLD_CONTENT_INSET,
    detailTop: insets.top,
    detailBottom: foldGlassBottomInset(insets.bottom),
    headerLift,
    headerTrailing: headerLift > 0 ? FOLD_PORTRAIT_STATUS_TRAILING : 0,
  }
}

/**
 * Shortest window that still counts as a tablet, not a phone on its side.
 * A landscape phone is wide enough for a sidebar (~852 pt) but only ~390 pt
 * tall — too short for the boxed composer, and too cramped to keep a pane
 * beside File Preview, Files, Terminal, and the git pickers.
 */
export const TABLET_MIN_HEIGHT = 500

export function shouldUseTabletComposer(width: number, height: number): boolean {
  return width >= TABLET_SPLIT_MIN_WIDTH && height >= TABLET_MIN_HEIGHT
}

// On a tablet these all keep the project/session master pane, so the git
// pickers read as a panel beside it rather than a full-screen takeover.
// A landscape phone only keeps chat: every other route needs the width.
const DETAIL_SCREENS = new Set(['chat', 'terminal', 'worktree', 'branch', 'add-dir', 'project-picker', 'add-project', 'settings', 'files', 'collab-request'])

export function shouldUseTabletMultiPane(
  width: number,
  height: number,
  screen: string,
  hasProject: boolean,
  hinge: HingePosture = 'unknown',
): boolean {
  if (workspaceSidebarWidth(width, height, hinge) == null || !hasProject || !DETAIL_SCREENS.has(screen)) return false
  if (screen === 'chat') return true
  return height >= TABLET_MIN_HEIGHT
}

/**
 * Screens that draw to the window edge instead of sitting inside the shell's
 * page padding. Transcripts, terminals and the git pickers all own full-width
 * rows or separators, and settings owns its card gutters, so an outer gutter
 * would stack on top of their own.
 */
const FULL_BLEED_SCREENS = new Set(['chat', 'terminal', 'worktree', 'branch', 'add-dir', 'project-picker', 'add-project', 'files', 'session-search', 'collab-request', 'settings'])

export function isFullBleedScreen(screen: string): boolean {
  return FULL_BLEED_SCREENS.has(screen)
}
