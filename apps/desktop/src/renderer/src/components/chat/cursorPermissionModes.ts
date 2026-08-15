import type { PermissionMode } from '@superone/shared/agent-types'

/**
 * Cursor permission modes shown in the status bar / launch popover.
 * Maps to SDK `mode` + `autoReview` (sandbox is a separate toggle).
 * Ids match Cursor CLI (`agent` / `plan`); Full Access is SuperOne's no-autoReview ladder.
 */
export const CURSOR_PERMISSION_MODES: PermissionMode[] = [
  'agent',
  'plan',
  'bypassPermissions',
]

/** Fallback when a Cursor session carries a Claude-only / legacy mode. */
export const CURSOR_DEFAULT_PERMISSION_MODE: PermissionMode = 'agent'

/**
 * Map a stored session mode onto the Cursor ladder.
 * Legacy SuperOne id `auto` is Agent + Auto-review.
 */
export function resolveCursorPermissionMode(mode: PermissionMode): PermissionMode {
  if (mode === 'auto' || mode === 'agent') return 'agent'
  if (CURSOR_PERMISSION_MODES.includes(mode)) return mode
  return CURSOR_DEFAULT_PERMISSION_MODE
}
