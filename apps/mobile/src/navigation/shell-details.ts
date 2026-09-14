import type { RelayClient } from '@superone/relay-client'
import type { GitDirtyStatus, HarnessId, RemoteSystemInfo, WorktreeInfo } from '@superone/shared/agent-types'
import { requestGitResource } from '../git-resource-cache'
import { requestHarnessResource } from '../harness-resource-cache'
import type { ShellGitInfo } from '../project-types'

export interface ShellDetails {
  git: ShellGitInfo | null
  /** Uncommitted diff per non-main worktree path, best effort; clean rows are absent. */
  worktreeDirty: Record<string, GitDirtyStatus>
  workspaceDirs: string[]
  worktree: WorktreeInfo | null
  system: RemoteSystemInfo | null
  branches: string[]
  checkedOutBranches: string[]
}

/** Read picker data lazily; catalog and git freshness are owned by their caches. */
export async function fetchShellDetails(
  client: RelayClient,
  projectPath: string,
  provider: HarnessId,
  refreshCatalog = false,
  includeWorktreeDirty = false,
): Promise<ShellDetails> {
  const [git, resources, worktree, system, branchResult, checkedOutResult] = await Promise.all([
    requestGitResource(client, 'get_git_info', projectPath)
      .catch(() => null) as Promise<ShellGitInfo | null>,
    requestHarnessResource(client, 'get_project_resources', projectPath, provider).catch(() => null),
    requestGitResource(client, 'get_worktree_info', projectPath)
      .catch(() => null) as Promise<WorktreeInfo | null>,
    requestHarnessResource(client, 'get_system_info', projectPath, provider, refreshCatalog).catch(() => null),
    requestGitResource(client, 'get_git_branches', projectPath)
      .catch(() => null) as Promise<{ branches?: string[] } | null>,
    requestGitResource(client, 'get_checked_out_branches', projectPath)
      .catch(() => null) as Promise<{ branches?: string[] } | null>,
  ])
  const worktreeDirty: Record<string, GitDirtyStatus> = {}
  // The desktop labels each dirty worktree row `N files +ins -del`; only a
  // per-path `get_git_info` can answer that, and a failure just leaves the row silent.
  await Promise.all((includeWorktreeDirty ? worktree?.entries ?? [] : []).filter((entry) => !entry.isMain).map(async (entry) => {
    const info = await requestGitResource(client, 'get_git_info', entry.path).catch(() => null) as ShellGitInfo | null
    if (info?.dirty) worktreeDirty[entry.path] = info.dirty
  }))
  return {
    git,
    worktreeDirty,
    workspaceDirs: resources?.workspaceDirs ?? [],
    worktree,
    system,
    branches: branchResult?.branches ?? [],
    checkedOutBranches: checkedOutResult?.branches ?? [],
  }
}
