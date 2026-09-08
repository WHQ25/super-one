import type { RelayClient } from '@superone/relay-client'
import type { HarnessId, RemoteCommand, RemoteSystemInfo, WorktreeInfo } from '@superone/shared/agent-types'
import { randomId } from '../ids'
import { requestHarnessResource } from '../harness-resource-cache'
import type { ShellGitInfo } from '../project-types'

export interface ShellDetails {
  git: ShellGitInfo | null
  /** Uncommitted file count per non-main worktree path, best effort. */
  worktreeDirty: Record<string, number>
  workspaceDirs: string[]
  worktree: WorktreeInfo | null
  system: RemoteSystemInfo | null
  branches: string[]
  checkedOutBranches: string[]
}

/**
 * `refreshCatalog` re-fetches the harness catalog instead of reading the
 * per-connection cache. The catalog carries the desktop's *configured* defaults
 * (model, effort, permission mode, sandbox), and that cache has no TTL — so a
 * default the user changed on the desktop would never reach a phone that stayed
 * connected. Only the new-session path pays for it: that is the one moment those
 * defaults are read, since an existing session carries its own settings.
 */
export async function fetchShellDetails(
  client: RelayClient,
  projectPath: string,
  provider: HarnessId,
  refreshCatalog = false,
): Promise<ShellDetails> {
  const [git, resources, worktree, system, branchResult, checkedOutResult] = await Promise.all([
    client.request({ type: 'get_git_info', requestId: randomId(), projectPath } as RemoteCommand)
      .catch(() => null) as Promise<ShellGitInfo | null>,
    requestHarnessResource(client, 'get_project_resources', projectPath, provider).catch(() => null),
    client.request({ type: 'get_worktree_info', requestId: randomId(), projectPath } as RemoteCommand)
      .catch(() => null) as Promise<WorktreeInfo | null>,
    requestHarnessResource(client, 'get_system_info', projectPath, provider, refreshCatalog).catch(() => null),
    client.request({ type: 'get_git_branches', requestId: randomId(), projectPath } as RemoteCommand)
      .catch(() => null) as Promise<{ branches?: string[] } | null>,
    client.request({ type: 'get_checked_out_branches', requestId: randomId(), projectPath } as RemoteCommand)
      .catch(() => null) as Promise<{ branches?: string[] } | null>,
  ])
  const worktreeDirty: Record<string, number> = {}
  // The desktop labels each worktree row `N files` / `clean`; only a per-path
  // `get_git_info` can answer that, and a failure just leaves the row silent.
  await Promise.all((worktree?.entries ?? []).filter((entry) => !entry.isMain).map(async (entry) => {
    const info = await client.request({
      type: 'get_git_info', requestId: randomId(), projectPath: entry.path,
    } as RemoteCommand).catch(() => null) as ShellGitInfo | null
    if (info) worktreeDirty[entry.path] = info.dirty?.files ?? 0
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
