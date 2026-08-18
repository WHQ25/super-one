import { isAbsolute, resolve } from 'node:path'

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
