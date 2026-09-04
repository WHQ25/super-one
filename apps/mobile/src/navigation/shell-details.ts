import type { RelayClient } from '@superone/relay-client'
import type { HarnessId, RemoteCommand, RemoteSystemInfo, WorktreeInfo } from '@superone/shared/agent-types'
import { randomId } from '../ids'
import type { ShellGitInfo } from '../screens/settings-screen'

export interface ShellDetails {
  git: ShellGitInfo | null
  workspaceDirs: string[]
  worktree: WorktreeInfo | null
  system: RemoteSystemInfo | null
  branches: string[]
  checkedOutBranches: string[]
}

export async function fetchShellDetails(
  client: RelayClient,
  projectPath: string,
  provider: HarnessId,
): Promise<ShellDetails> {
  const [git, resources, worktree, system, branchResult, checkedOutResult] = await Promise.all([
    client.request({ type: 'get_git_info', requestId: randomId(), projectPath } as RemoteCommand)
      .catch(() => null) as Promise<ShellGitInfo | null>,
    client.request({
      type: 'get_project_resources',
      requestId: randomId(),
      projectPath,
      provider,
    } as RemoteCommand).catch(() => null) as Promise<{ workspaceDirs?: string[] } | null>,
    client.request({ type: 'get_worktree_info', requestId: randomId(), projectPath } as RemoteCommand)
      .catch(() => null) as Promise<WorktreeInfo | null>,
    client.request({
      type: 'get_system_info',
      requestId: randomId(),
      projectPath,
      provider,
    } as RemoteCommand).catch(() => null) as Promise<RemoteSystemInfo | null>,
    client.request({ type: 'get_git_branches', requestId: randomId(), projectPath } as RemoteCommand)
      .catch(() => null) as Promise<{ branches?: string[] } | null>,
    client.request({ type: 'get_checked_out_branches', requestId: randomId(), projectPath } as RemoteCommand)
      .catch(() => null) as Promise<{ branches?: string[] } | null>,
  ])
  return {
    git,
    workspaceDirs: resources?.workspaceDirs ?? [],
    worktree,
    system,
    branches: branchResult?.branches ?? [],
    checkedOutBranches: checkedOutResult?.branches ?? [],
  }
}
