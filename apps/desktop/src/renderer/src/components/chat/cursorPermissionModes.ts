import type { PermissionMode } from '@superone/shared/agent-types'

/**
 * Cursor permission modes shown in the status bar / launch popover.
 * Maps to SDK `mode` + `autoReview` (sandbox is a separate toggle).
 */
export const CURSOR_PERMISSION_MODES: PermissionMode[] = [
  'auto',
  'plan',
  'bypassPermissions',
]

/** Fallback when a Cursor session carries a Claude-only / legacy mode. */
export const CURSOR_DEFAULT_PERMISSION_MODE: PermissionMode = 'auto'
