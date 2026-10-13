import type { WorkspaceGitPort } from '@superone/runtime/server'
import { fetchRemoteCommands } from '@superone/runtime/git'
import { WorkspaceGitService, type WorkspaceProjects } from '@superone/runtime/workspace'
import { gitRun } from '../git-run'
import { activateWorktree } from '../git/worktree-ops'

/**
 * `git.*` for every client of this desktop (its window, phones and controller
 * desktops): the runtime service, except that worktrees are cut the way the
 * window cuts them (one at a time per repository, a free path on collision,
 * which parallel collaboration starts rely on) and fetches do not block main.
 */
export function createDesktopGitPort(projects: WorkspaceProjects): WorkspaceGitPort {
  const git = new WorkspaceGitService(projects)
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
    async activateWorktree(projectId, input) {
      return { path: (await activateWorktree(projectRoot(projectId), input)).path }
    },
    async fetch(projectId, remote) {
      const root = projectRoot(projectId)
      const { fetch, setHead } = fetchRemoteCommands(remote)
      await gitRun(root, fetch)
      // The remote may have no default branch to point at.
      await gitRun(root, setHead).catch(() => undefined)
    },
  }
}
