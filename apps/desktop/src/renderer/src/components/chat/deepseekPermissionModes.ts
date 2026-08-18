import type { PermissionMode } from '@superone/shared/agent-types'

/**
 * Modes the DeepSeek backend honors today: ask-per-tool or auto-allow.
 * The dsh permission-preset vocabulary (workspace-write / danger-full-access)
 * replaces this subset when the bash executor + dsh-permission-presets land
 * (P4) — presets bundle sandbox and approval knobs the current tree lacks.
 */
export const DEEPSEEK_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'bypassPermissions',
]
