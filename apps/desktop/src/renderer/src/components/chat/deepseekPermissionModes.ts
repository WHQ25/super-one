import type { PermissionMode } from '@superone/shared/agent-types'

/**
 * dsh's permission presets, in the vocabulary dsh itself uses (decision D5).
 *
 * The shared `PermissionMode` stays the carrier across the store and wire — it
 * is what `setPermissionMode` sends and what the status bar reads — but the
 * label a dsh user sees is the preset's, because the preset is what actually
 * happens: each one bundles a sandbox mode enforced by the shell and filesystem
 * with whether approval questions are asked at all.
 *
 * `packages/deepseek/src/permission-presets.ts` owns the other half of this
 * table (the knob bundle and the mode → preset map). The two are separate
 * because the renderer must not pull dsh's runtime into its bundle.
 */
export interface DeepseekPermissionModeMeta {
  mode: PermissionMode
  /** The dsh preset this carrier mode selects. */
  preset: 'read-only' | 'workspace-write' | 'danger-full-access'
  labelKey: string
  descriptionKey: string
}

export const DEEPSEEK_PERMISSION_MODE_META: DeepseekPermissionModeMeta[] = [
  {
    mode: 'plan',
    preset: 'read-only',
    labelKey: 'chat.deepseekPermissionPresets.readOnly.label',
    descriptionKey: 'chat.deepseekPermissionPresets.readOnly.description',
  },
  {
    mode: 'default',
    preset: 'workspace-write',
    labelKey: 'chat.deepseekPermissionPresets.workspaceWrite.label',
    descriptionKey: 'chat.deepseekPermissionPresets.workspaceWrite.description',
  },
  {
    mode: 'bypassPermissions',
    preset: 'danger-full-access',
    labelKey: 'chat.deepseekPermissionPresets.fullAccess.label',
    descriptionKey: 'chat.deepseekPermissionPresets.fullAccess.description',
  },
]

/** Cycle order for Shift+Tab, and the set the selector accepts. */
export const DEEPSEEK_PERMISSION_MODES: PermissionMode[] =
  DEEPSEEK_PERMISSION_MODE_META.map((meta) => meta.mode)

export const DEEPSEEK_DEFAULT_PERMISSION_MODE: PermissionMode = 'default'

export function deepseekPermissionModeMeta(mode: PermissionMode): DeepseekPermissionModeMeta {
  return DEEPSEEK_PERMISSION_MODE_META.find((meta) => meta.mode === mode)
    ?? DEEPSEEK_PERMISSION_MODE_META[1]
}
