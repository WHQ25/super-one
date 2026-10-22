/**
 * Remote git worktree mutations via node RPC.
 * Paths on the node are host-absolute; UI may store remote:<conn>:<hostPath>.
 */

import type {
  WorktreeActivateRequest,
  WorktreeAssignResult,
  WorktreeHandoffResult,
  GitDirtyStatus,
} from '@superone/shared/agent-types'
import { parseRemoteProjectKey, remoteProjectKey } from '@superone/shared/remote-resource-key'
import { sanitizeGitRef } from '../path-security'
import type { EnvironmentHost } from './environment-host'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'
import { resolveRemoteProjectContext } from './remote-file-tree'

function asRemoteGw(host: EnvironmentHost, environmentId: string): RemoteEnvironmentGateway | null {
  const gw = host.getGateway(environmentId)
  return gw instanceof RemoteEnvironmentGateway ? gw : null
}

function hostPathOf(folderOrRemoteKey: string): string {
  const remote = parseRemoteProjectKey(folderOrRemoteKey)
  return remote?.path ?? folderOrRemoteKey
}

export async function remoteActivateWorktree(
  host: EnvironmentHost,
  folderPath: string,
  request: WorktreeActivateRequest | null,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return { ok: false, error: 'not a remote project' }
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return { ok: false, error: 'environment is not connected' }

  try {
    if (request === null) {
      // Clear worktree — callers set session cwd to project root separately.
      return { ok: true, path: ctx.hostPath }
    }
    const result = (await gw.gitWorktreeActivate(ctx.projectId, {
      baseBranch: request.baseBranch,
      mode: request.mode,
      branchName: request.branchName,
      carryLocalChanges: request.carryLocalChanges,
    })) as { path: string; recordedBranch?: string | null }
    if (!result?.path) return { ok: false, error: 'worktree activate returned no path' }
    // Return remote key so UI git/status routing stays on the remote path.
    return { ok: true, path: remoteProjectKey(ctx.connectionId, result.path) }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'worktree activate failed' }
  }
}

export async function remoteCheckedOutBranches(
  host: EnvironmentHost,
  folderPath: string,
): Promise<string[] | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return []
  try {
    const result = (await gw.gitWorktreeCheckedOutBranches(ctx.projectId)) as {
      branches?: string[]
    }
    return Array.isArray(result?.branches) ? result.branches : []
  } catch {
    return []
  }
}

export async function remoteAssignBranch(
  host: EnvironmentHost,
  folderPath: string,
  worktreePath: string,
  name: string,
): Promise<WorktreeAssignResult> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return { ok: false, reason: 'error', error: 'not a remote project' }
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return { ok: false, reason: 'error', error: 'environment is not connected' }
  try {
    return (await gw.gitWorktreeAssignBranch(
      ctx.projectId,
      hostPathOf(worktreePath),
      name,
    )) as WorktreeAssignResult
  } catch (err) {
    return { ok: false, reason: 'error', error: (err as Error).message }
  }
}

export async function remoteHandoffToMain(
  host: EnvironmentHost,
  folderPath: string,
  worktreePath: string,
): Promise<WorktreeHandoffResult> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return { ok: false, reason: 'error', error: 'not a remote project' }
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return { ok: false, reason: 'error', error: 'environment is not connected' }
  try {
    const result = (await gw.gitWorktreeHandoff(
      ctx.projectId,
      hostPathOf(worktreePath),
    )) as {
      ok: boolean
      reason?: string
      error?: string
    }
    if (result.ok) return { ok: true }
    // Map main-dirty → local-dirty for existing UI copy keys.
    const reason = result.reason === 'main-dirty' ? 'local-dirty' : result.reason
    return {
      ok: false,
      reason: (reason as WorktreeHandoffResult extends { ok: false; reason: infer R } ? R : never) || 'error',
      error: result.error,
    }
  } catch (err) {
    return { ok: false, reason: 'error', error: (err as Error).message }
  }
}

export async function remoteHandoffPreview(
  host: EnvironmentHost,
  folderPath: string,
  worktreePath: string,
): Promise<GitDirtyStatus | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return null
  try {
    const result = (await gw.gitWorktreeHandoffPreview(
      ctx.projectId,
      hostPathOf(worktreePath),
    )) as GitDirtyStatus | null
    return result
  } catch {
    return null
  }
}

export async function remoteSetSessionCwd(
  host: EnvironmentHost,
  connectionId: string,
  sessionId: string,
  cwdHostPath: string | null,
): Promise<void> {
  await host.setSessionCwd(connectionId, sessionId, cwdHostPath)
}

/**
 * Switch or create a branch on the remote project (or a worktree if folderPath is a wt key).
 * When folderPath is the project remote key, operates at project root.
 * When folderPath is a worktree remote key under the same connection, pass cwd=host wt path —
 * but resolveRemoteProjectContext expects a registered project path, so callers should pass
 * the **project** key as folderPath and optional worktree host cwd separately if needed.
 */
export async function remoteSwitchBranch(
  host: EnvironmentHost,
  folderPath: string,
  branch: string,
  create = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return { ok: false, error: 'not a remote project' }
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return { ok: false, error: 'environment is not connected' }
  let safeBranch: string
  try {
    safeBranch = sanitizeGitRef(branch)
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'invalid branch name' }
  }
  try {
    // If folderPath host path differs from project root, treat as worktree cwd.
    const pathPart = hostPathOf(folderPath)
    const atWorktree = pathPart.replace(/\/$/, '') !== ctx.hostPath.replace(/\/$/, '')
    const result = (await gw.gitSwitchBranch(ctx.projectId, safeBranch, {
      create,
      ...(atWorktree ? { cwd: pathPart } : {}),
    })) as { ok?: boolean; error?: string }
    if (result && result.ok === false) {
      return { ok: false, error: result.error || 'branch operation failed' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'branch operation failed' }
  }
}
