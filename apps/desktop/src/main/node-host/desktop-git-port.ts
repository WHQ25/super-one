import type { WorkspaceGitPort } from '@superone/runtime/server'
import { WorkspaceGitService, type WorkspaceProjects } from '@superone/runtime/workspace'
import { ghRun, gitRun } from '../git-run'

/**
 * `git.*` for every client of this desktop (its window, phones and controller
 * desktops): the runtime service on the window's login-shell runners. Its
 * worktree activation queues per repository with the window's own activations
 * (one shared lock in this process) and takes a free path on collision.
 */
export function createDesktopGitPort(projects: WorkspaceProjects): WorkspaceGitPort {
  return new WorkspaceGitService(projects, { gitRun, ghRun })
}
