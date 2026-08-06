/**
 * Root guard for Claude Agent SDK spawn options.
 *
 * Claude Code exits with
 * `--dangerously-skip-permissions cannot be used with root/sudo privileges for
 * security reasons` when it would skip permission prompts under uid 0. Two
 * option knobs trip it: `permissionMode: 'bypassPermissions'` **and**
 * `allowDangerouslySkipPermissions: true` — the latter on its own, whatever the
 * permission mode is. SuperOne sets the flag unconditionally, so a node running
 * as root (a common container / systemd setup) fails every turn during spawn,
 * before any assistant output exists.
 *
 * The host can opt out of the guard the same way Claude Code does: `IS_SANDBOX=1`
 * or `CLAUDE_CODE_BUBBLEWRAP`. Both mean "this process is already isolated".
 */

/** Permission mode used in place of `bypassPermissions` under root. */
export const ROOT_SAFE_PERMISSION_MODE = 'acceptEdits'

export interface RootPermissionGuardEnvironment {
  /** `process.getuid?.()` — undefined on platforms without uids (Windows). */
  uid?: number | null
  /** Environment the harness process will see (not necessarily `process.env`). */
  env?: Record<string, string | undefined>
}

export interface RootPermissionGuardInput extends RootPermissionGuardEnvironment {
  permissionMode?: string | null
}

export interface RootPermissionGuardResult {
  permissionMode: string | undefined
  allowDangerouslySkipPermissions: boolean
  /** True when the spawn would have been refused and options were relaxed. */
  applied: boolean
  /** Original mode when it had to be replaced, else null. */
  downgradedFrom: string | null
}

/** Whether Claude Code would refuse permission-skipping options in this process. */
export function isRootWithoutSandboxOptIn(opts: RootPermissionGuardEnvironment): boolean {
  if (opts.uid !== 0) return false
  const env = opts.env ?? {}
  if (env.IS_SANDBOX === '1') return false
  if (env.CLAUDE_CODE_BUBBLEWRAP) return false
  return true
}

/**
 * Relax permission-skipping options so the harness process can start under root.
 * Off root (or with an explicit sandbox opt-in) the input passes through.
 */
export function applyRootPermissionGuard(
  input: RootPermissionGuardInput,
): RootPermissionGuardResult {
  const mode = input.permissionMode?.trim() ? input.permissionMode.trim() : undefined
  if (!isRootWithoutSandboxOptIn(input)) {
    return {
      permissionMode: mode,
      allowDangerouslySkipPermissions: true,
      applied: false,
      downgradedFrom: null,
    }
  }
  const downgrade = mode === 'bypassPermissions'
  return {
    permissionMode: downgrade ? ROOT_SAFE_PERMISSION_MODE : mode,
    allowDangerouslySkipPermissions: false,
    applied: true,
    downgradedFrom: downgrade ? mode! : null,
  }
}
