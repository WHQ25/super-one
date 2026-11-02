import {
  CODEX_PERMISSION_PRESETS,
  DEFAULT_CODEX_PERMISSION_PRESET,
  DEFAULT_CODEX_PERMISSION_PROFILE,
  isCodexPermissionPreset,
  type CodexPermissionPreset,
  type CodexPermissionProfile,
} from '@superone/shared/agent-types'

/** Desktop `resolvePermissionProfile`: an unset preset is `auto-review`, not full access. */
export function resolveCodexPermissionProfile(preset?: string | null): CodexPermissionProfile & {
  permissionPreset: CodexPermissionPreset
} {
  const permissionPreset = isCodexPermissionPreset(preset) ? preset : DEFAULT_CODEX_PERMISSION_PRESET
  const profile = CODEX_PERMISSION_PRESETS[permissionPreset] ?? DEFAULT_CODEX_PERMISSION_PROFILE
  return { permissionPreset, ...profile }
}
