import type { WorkspaceGitPort } from '@superone/runtime/server'
import { WorkspaceGitService, type WorkspaceProjects } from '@superone/runtime/workspace'
import { ghRun, gitRun } from '../git-run'
import { activateWorktree } from '../git/worktree-ops'

/**
 * `git.*` for every client of this desktop (its window, phones and controller
 * desktops): the runtime service on the window's login-shell runners, except
 * that worktrees are cut the way the window cuts them (one at a time per
 * repository, a free path on collision, which parallel collaboration starts
 * rely on).
 */
export function createDesktopGitPort(projects: WorkspaceProjects): WorkspaceGitPort {
  const git = new WorkspaceGitService(projects, { gitRun, ghRun })
  const projectRoot = (projectId: string): string => {
    const path = projects.get(projectId)?.path
    if (!path) throw Object.assign(new Error(`unknown projectId: ${projectId}`), { code: 'not_found' })
    return path
  }

  return {
    status: (projectId) => git.status(projectId),
    statusAt: (projectId, absolutePath) => git.statusAt(projectId, absolutePath),
    diff: (projectId, opts) => git.diff(projectId, opts),
    branches: (projectId, absolutePath) => git.branches(projectId, absolutePath),
    switchBranch: (projectId, branch, opts) => git.switchBranch(projectId, branch, opts),
    worktrees: (projectId) => git.worktrees(projectId),
    checkedOutBranches: (projectId) => git.checkedOutBranches(projectId),
    removeWorktree: (projectId, worktreePath) => git.removeWorktree(projectId, worktreePath),
    assignBranch: (projectId, worktreePath, rawName) => git.assignBranch(projectId, worktreePath, rawName),
    handoffToMain: (projectId, worktreePath) => git.handoffToMain(projectId, worktreePath),
    handoffPreview: (projectId, worktreePath) => git.handoffPreview(projectId, worktreePath),
    mentionRefs: (projectId, kind, query, absolutePath) => git.mentionRefs(projectId, kind, query, absolutePath),
    mentionCapabilities: (projectId, absolutePath) => git.mentionCapabilities(projectId, absolutePath),
    isAllowedSessionCwd: (projectId, cwd) => git.isAllowedSessionCwd(projectId, cwd),
    fetch: (projectId, remote) => git.fetch(projectId, remote),
    async activateWorktree(projectId, input) {
      return { path: (await activateWorktree(projectRoot(projectId), input)).path }
    },
  }
}
