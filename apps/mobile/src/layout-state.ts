export const TABLET_SPLIT_MIN_WIDTH = 768

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
const DETAIL_SCREENS = new Set(['chat', 'terminal', 'worktree', 'branch', 'add-dir', 'project-picker', 'add-project', 'settings', 'files', 'collab-request', 'collab-task'])

export function shouldUseTabletMultiPane(
  width: number,
  height: number,
  screen: string,
  hasProject: boolean,
): boolean {
  if (width < TABLET_SPLIT_MIN_WIDTH || !hasProject || !DETAIL_SCREENS.has(screen)) return false
  if (screen === 'chat') return true
  return height >= TABLET_MIN_HEIGHT
}

/**
 * Screens that draw to the window edge instead of sitting inside the shell's
 * page padding. Transcripts, terminals and the git pickers all own full-width
 * rows or separators, so an outer gutter would stack on top of their own.
 */
const FULL_BLEED_SCREENS = new Set(['chat', 'terminal', 'worktree', 'branch', 'add-dir', 'project-picker', 'add-project', 'files', 'session-search', 'collab-request', 'collab-task'])

export function isFullBleedScreen(screen: string): boolean {
  return FULL_BLEED_SCREENS.has(screen)
}
