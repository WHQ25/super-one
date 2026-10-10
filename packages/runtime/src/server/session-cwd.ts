import { resolve as pathResolve } from 'node:path'
import type { RpcContext } from './rpc-context'

/** A session may use the project root and its registered worktrees. */
export function isAllowedSessionCwd(ctx: RpcContext, projectId: string, cwd: string): boolean {
  const git = ctx.workspaceGit
  if (git) return git.isAllowedSessionCwd(projectId, cwd)
  const root = ctx.projects?.get(projectId)?.path
  return !!root && pathResolve(cwd) === pathResolve(root)
}
