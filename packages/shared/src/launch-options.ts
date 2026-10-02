import type { HarnessId, PermissionMode, SandboxMode } from './agent-types'

/** Launch-confirm controls use the same per-harness vocabulary as desktop. */
export const HARNESS_LAUNCH_OPTIONS: Record<HarnessId, { permissionModes: PermissionMode[]; sandboxModes: SandboxMode[] }> = {
  claude: { permissionModes: ['default', 'plan', 'auto', 'acceptEdits', 'dontAsk', 'bypassPermissions'], sandboxModes: ['off', 'on', 'auto'] },
  codex: { permissionModes: ['default', 'auto', 'bypassPermissions'], sandboxModes: [] },
  acp: { permissionModes: ['default', 'plan', 'auto', 'bypassPermissions'], sandboxModes: [] },
  // OpenCode selects native agents; permissions come from its own configuration.
  opencode: { permissionModes: [], sandboxModes: [] },
  cursor: { permissionModes: ['agent', 'plan', 'bypassPermissions'], sandboxModes: ['off', 'on'] },
  dsh: { permissionModes: ['plan', 'default', 'bypassPermissions'], sandboxModes: [] },
}
