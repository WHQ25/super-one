/**
 * Cold-start milestones recorded as User Timing marks in whichever process
 * reaches them (main uses Node's `performance`, the renderer the DOM one).
 * `apps/desktop/scripts/bench-startup.ts` reads both timelines back.
 */
export const STARTUP_MARK_PREFIX = 'superone:startup:'

export type StartupMark =
  | 'main-evaluated'
  | 'app-ready'
  | 'window-created'
  | 'renderer-evaluated'
  | 'react-render'
  | 'composer-ready'

/** Records the first occurrence only; later windows or remounts are ignored. */
export function markStartup(name: StartupMark): void {
  const entry = STARTUP_MARK_PREFIX + name
  if (performance.getEntriesByName(entry, 'mark').length === 0) performance.mark(entry)
}
