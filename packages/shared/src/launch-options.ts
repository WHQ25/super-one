import type { HarnessId, PermissionMode, SandboxMode } from './agent-types'

export interface HarnessLaunchOptions {
  permissionModes: PermissionMode[]
  sandboxModes: SandboxMode[]
  /**
   * The mode a session or launch starts in when the user has not chosen one:
   * the harness's own recommended default, not the first entry of
   * `permissionModes` (which is display order).
   */
  defaultPermissionMode: PermissionMode
}

/** Launch-confirm controls use the same per-harness vocabulary as desktop. */
export const HARNESS_LAUNCH_OPTIONS: Record<HarnessId, HarnessLaunchOptions> = {
  claude: { permissionModes: ['default', 'plan', 'auto', 'acceptEdits', 'dontAsk', 'bypassPermissions'], sandboxModes: ['off', 'on', 'auto'], defaultPermissionMode: 'default' },
  codex: { permissionModes: ['default', 'auto', 'bypassPermissions'], sandboxModes: [], defaultPermissionMode: 'default' },
  acp: { permissionModes: ['default', 'plan', 'auto', 'bypassPermissions'], sandboxModes: [], defaultPermissionMode: 'default' },
  // OpenCode selects native agents; permissions come from its own configuration.
  opencode: { permissionModes: [], sandboxModes: [], defaultPermissionMode: 'default' },
  cursor: { permissionModes: ['agent', 'plan', 'bypassPermissions'], sandboxModes: ['off', 'on'], defaultPermissionMode: 'agent' },
  // Read-only first for display; dsh's own default preset is `workspace-write` (`default`).
  dsh: { permissionModes: ['plan', 'default', 'bypassPermissions'], sandboxModes: [], defaultPermissionMode: 'default' },
}
