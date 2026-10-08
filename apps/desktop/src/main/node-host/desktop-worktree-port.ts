import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ProjectsPort, WorkspaceGitPort } from '@superone/runtime/server'
import { unsupportedMethodError } from '@superone/runtime/server'
import { fetchRemoteCommands } from '@superone/runtime/git'
import { gitRun } from '../git-run'
import { activateWorktree } from '../git/worktree-ops'

function canonical(path: string): string {
  try {
    return realpathSync(resolve(path))
  } catch {
    return resolve(path)
  }
}

/**
 * The part of `git.*` this desktop serves to other devices: creating a fresh
 * worktree, so a session another machine launches here works on its own
 * branch without touching this desktop's checkout. A session may then run in
 * the project root or a worktree created here. Fetching the remote first keeps
 * the base current. Every other git method stays with this desktop's user and
 * answers unsupported.
 */
export function createDesktopWorktreePort(projects: ProjectsPort): WorkspaceGitPort {
  /** projectId → worktrees created through this port (canonical paths). */
  const created = new Map<string, Set<string>>()
  const unsupported = (method: string) => (): never => {
    throw unsupportedMethodError(method)
  }
  const projectRoot = (projectId: string): string => {
    const path = projects.get(projectId)?.path
    if (!path) throw Object.assign(new Error(`unknown projectId: ${projectId}`), { code: 'not_found' })
    return path
  }

  return {
    servedMethods: new Set(['git.worktreeActivate', 'git.fetch']),
    async fetch(projectId, remote) {
      const root = projectRoot(projectId)
      const { fetch, setHead } = fetchRemoteCommands(remote)
      await gitRun(root, fetch)
      // The remote may have no default branch to point at.
      await gitRun(root, setHead).catch(() => undefined)
    },
    async activateWorktree(projectId, input) {
      const { path } = await activateWorktree(projectRoot(projectId), input)
      const paths = created.get(projectId) ?? new Set<string>()
      paths.add(canonical(path))
      created.set(projectId, paths)
      return { path }
    },
    isAllowedSessionCwd(projectId, cwd) {
      if (!cwd) return true
      const root = projects.get(projectId)?.path
      if (!root) return false
      const target = canonical(cwd)
      return target === canonical(root) || !!created.get(projectId)?.has(target)
    },
    status: unsupported('git.status'),
    statusAt: unsupported('git.status'),
    diff: unsupported('git.diff'),
    branches: unsupported('git.branches'),
    switchBranch: unsupported('git.switchBranch'),
    worktrees: unsupported('git.worktrees'),
    checkedOutBranches: unsupported('git.worktreeCheckedOutBranches'),
    removeWorktree: unsupported('git.worktreeRemove'),
    assignBranch: unsupported('git.worktreeAssignBranch'),
    handoffToMain: unsupported('git.worktreeHandoff'),
    handoffPreview: unsupported('git.worktreeHandoffPreview'),
    mentionRefs: async () => unsupported('git.mentionRefs')(),
    mentionCapabilities: async () => unsupported('git.mentionCapabilities')(),
  }
}
