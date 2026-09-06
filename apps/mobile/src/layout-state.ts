export const TABLET_SPLIT_MIN_WIDTH = 768

// On a tablet these all keep the project/session master pane, so the git
// pickers read as a panel beside it rather than a full-screen takeover.
const DETAIL_SCREENS = new Set(['chat', 'terminal', 'worktree', 'branch', 'settings', 'files'])

export function shouldUseTabletMultiPane(
  width: number,
  screen: string,
  hasProject: boolean,
): boolean {
  return width >= TABLET_SPLIT_MIN_WIDTH && hasProject && DETAIL_SCREENS.has(screen)
}

/**
 * Screens that draw to the window edge instead of sitting inside the shell's
 * page padding. Transcripts, terminals and the git pickers all own full-width
 * rows or separators, so an outer gutter would stack on top of their own.
 */
const FULL_BLEED_SCREENS = new Set(['chat', 'terminal', 'worktree', 'branch'])

export function isFullBleedScreen(screen: string): boolean {
  return FULL_BLEED_SCREENS.has(screen)
}
