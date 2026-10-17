import type { HarnessId, SessionAgentLaunchConfig, SessionAgentLaunchProposal } from './agent-types'
import { canonicalJson } from './request-coalescer'
import { resolveSandboxMode, sandboxInfoFromMode } from './harness/harness-sandbox'

/** Native permission presets own the sandbox on Codex/dsh; an absent toggle is not "off". */
export function profileLaunchSandboxMode(config: SessionAgentLaunchConfig, harnessId?: HarnessId) {
  return harnessId ? resolveSandboxMode({ harnessId, permissionMode: config.permissionMode, codexPreset: config.codexPermissionPreset, sandboxInfo: sandboxInfoFromMode(config.sandboxMode ?? 'off') }) : config.sandboxMode ?? 'off'
}

/** Apply current runtime defaults while preserving only the invocation's labels and workspace. */
export function profileLaunchConfig(config: SessionAgentLaunchConfig, defaults: SessionAgentLaunchConfig): SessionAgentLaunchConfig {
  const { name, role, cwd, worktree } = config
  return { permissionMode: 'default', sandboxMode: 'off', ...defaults, name, role, cwd, ...(worktree ? { worktree } : {}) }
}

/** Scope reusable consent to exact local defaults and same-project worktrees. */
export function matchesProfileLaunchDefaults(launch: SessionAgentLaunchProposal, defaults: SessionAgentLaunchConfig, cwd: string): boolean {
  if (launch.mode === 'link' || launch.config.remote || launch.config.cwd !== cwd) return false
  const { name: _name, role: _role, cwd: _cwd, worktree, ...runtime } = launch.config
  if (worktree?.enabled && (worktree.carryLocalChanges || !['branch', 'detach'].includes(worktree.mode ?? '')
    || (worktree.mode === 'branch' && !worktree.branchName?.trim()))) return false
  return JSON.stringify(canonicalJson(runtime)) === JSON.stringify(canonicalJson({ permissionMode: 'default', sandboxMode: 'off', ...defaults }))
}
