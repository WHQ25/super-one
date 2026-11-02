import { isAbsolute, resolve } from 'node:path'
import type { CodexSandboxMode } from '@superone/shared/agent-types'

export interface CodexWorkspaceWriteSandboxOptions {
  readOnlyAccess?: Record<string, unknown>
  networkAccess?: boolean
  excludeTmpdirEnvVar?: boolean
  excludeSlashTmp?: boolean
}

export function resolveCodexWritableRoots(cwd: string, additionalDirectories: readonly string[] = []): string[] {
  const roots = [cwd, ...additionalDirectories]
    .filter((dir) => dir.trim().length > 0)
    .map((dir) => isAbsolute(dir) ? resolve(dir) : resolve(cwd, dir))
  return Array.from(new Set(roots))
}

/** Sandbox object for turn/start and thread/settings/update, matching the desktop turn. */
export function buildCodexSandboxPolicy(
  cwd: string,
  profile: { sandboxMode: CodexSandboxMode; networkAccessEnabled: boolean },
  additionalDirectories: readonly string[] = [],
): Record<string, unknown> {
  if (profile.sandboxMode === 'danger-full-access') return { type: 'dangerFullAccess' }
  if (profile.sandboxMode === 'read-only') return { type: 'readOnly', access: { type: 'fullAccess' } }
  return buildCodexWorkspaceWriteSandboxPolicy(cwd, additionalDirectories, {
    readOnlyAccess: { type: 'fullAccess' },
    networkAccess: profile.networkAccessEnabled,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  })
}

export function buildCodexWorkspaceWriteSandboxPolicy(
  cwd: string,
  additionalDirectories: readonly string[] = [],
  options: CodexWorkspaceWriteSandboxOptions = {},
): Record<string, unknown> {
  return {
    type: 'workspaceWrite',
    writableRoots: resolveCodexWritableRoots(cwd, additionalDirectories),
    ...(options.readOnlyAccess ? { readOnlyAccess: options.readOnlyAccess } : {}),
    ...(options.networkAccess !== undefined ? { networkAccess: options.networkAccess } : {}),
    ...(options.excludeTmpdirEnvVar !== undefined ? { excludeTmpdirEnvVar: options.excludeTmpdirEnvVar } : {}),
    ...(options.excludeSlashTmp !== undefined ? { excludeSlashTmp: options.excludeSlashTmp } : {}),
  }
}
