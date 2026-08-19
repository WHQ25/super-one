import type { PermissionMode } from '@superone/shared/agent-types'

/**
 * dsh's own permission vocabulary. Each preset bundles the two mechanism knobs
 * dsh actually enforces — the sandbox mode the shell and filesystem run under,
 * and whether approval questions are asked at all.
 *
 * This is the semantic source; SuperOne's shared `PermissionMode` stays the
 * carrier across the store and wire surfaces and is mapped onto these names for
 * display (decision D5).
 */
export type DshPermissionPreset = 'read-only' | 'workspace-write' | 'danger-full-access'

interface PresetSpec {
  sandbox: DshPermissionPreset
  approval: 'ask' | 'never'
  name: string
  description: string
}

/**
 * The table `dsh-permission-presets` is configured with.
 *
 * dsh ships two entries by default (`workspace-write` and
 * `danger-full-access`); `read-only` is added because SuperOne offers a
 * look-but-do-not-touch mode on every other harness, and dsh's sandbox
 * vocabulary already has the mode — only the preset row was missing.
 */
export const DSH_PERMISSION_PRESETS: Record<DshPermissionPreset, PresetSpec> = {
  'read-only': {
    sandbox: 'read-only',
    approval: 'ask',
    name: 'Read-only',
    description: 'No writes anywhere. Reads and searches run freely.',
  },
  'workspace-write': {
    sandbox: 'workspace-write',
    approval: 'ask',
    name: 'Workspace write',
    description: 'Writes only inside this project and the temp directories. Asks before each one.',
  },
  'danger-full-access': {
    sandbox: 'danger-full-access',
    approval: 'never',
    name: 'Full access',
    description: 'No confinement and no questions. Everything the shell can reach is writable.',
  },
}

export const DEFAULT_DSH_PERMISSION_PRESET: DshPermissionPreset = 'workspace-write'

/**
 * SuperOne's shared mode → dsh's preset.
 *
 * `plan` carries `read-only` because that is what SuperOne's plan mode enforces
 * on every harness that has one: look, do not touch. dsh has no plan *approval*
 * round trip, so nothing else about the mode is claimed.
 *
 * The record is exhaustive on purpose. `PermissionMode` is shared across every
 * harness, so a new member should force a dsh decision here rather than fall
 * through a default — that is the one seam the compiler can enforce.
 *
 * Four members are not offered in the picker and land on the default:
 * `acceptEdits` (dsh's presets do not separate file edits from other effects),
 * `dontAsk` and `auto` (auto-approval without dropping confinement is not a
 * bundle dsh's preset table can express), and `agent` (a Claude-side notion).
 * Falling back is right for these — silently meaning something else is not.
 */
const PRESET_BY_MODE: Record<PermissionMode, DshPermissionPreset> = {
  plan: 'read-only',
  default: 'workspace-write',
  acceptEdits: 'workspace-write',
  dontAsk: 'workspace-write',
  auto: 'workspace-write',
  agent: 'workspace-write',
  bypassPermissions: 'danger-full-access',
}

export function dshPresetForMode(mode: PermissionMode): DshPermissionPreset {
  return PRESET_BY_MODE[mode] ?? DEFAULT_DSH_PERMISSION_PRESET
}
