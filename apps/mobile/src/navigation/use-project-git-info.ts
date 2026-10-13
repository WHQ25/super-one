import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { ShellGitInfo } from '../project-types'
import type { WorktreeInfo } from '@superone/shared/agent-types'
import { invalidateGitResources, requestGitResource } from '../git-resource-cache'
import { fetchProjectGitInfo, gitTurnEnded } from '../session-git-refresh'

/**
 * Live `get_git_info` for the open project.
 *
 * Auto-refresh (turn end, switching back to a session) only has to keep the
 * dirty/clean chip honest. Opening the branch page is the moment the user
 * looks at file counts and diff stats, so that path refreshes again.
 */
export function useProjectGitInfo(opts: {
  clientRef: RefObject<RelayClient | null>
  projectPath: string | null | undefined
  sessionId: string | null
  streaming: boolean
  onWorktreeInfo?: (value: WorktreeInfo | null) => void
  worktreePath?: string | null
}) {
  const { clientRef, projectPath, sessionId, streaming, onWorktreeInfo, worktreePath } = opts
  const [gitInfo, setGitInfo] = useState<ShellGitInfo | null>(null)
  const generation = useRef(0)
  const turnRef = useRef({ sessionId, streaming })

  const refresh = useCallback(async (path: string | null | undefined = projectPath, force = false) => {
    const client = clientRef.current
    if (!client || !path) return
    if (force) invalidateGitResources(client, path)
    const request = ++generation.current
    const [git, worktree] = await Promise.all([
      fetchProjectGitInfo(client, path),
      onWorktreeInfo ? requestGitResource(client, 'git.worktreeInfo', path).catch(() => null) : null,
    ])
    if (request !== generation.current || clientRef.current !== client) return
    setGitInfo(git)
    if (worktree) onWorktreeInfo?.(worktree)
  }, [clientRef, projectPath, onWorktreeInfo])

  const replace = useCallback((git: ShellGitInfo | null) => {
    generation.current += 1
    setGitInfo(git)
  }, [])

  // Restored and newly created worktrees both need their own branch/HEAD;
  // the project's status cannot describe a detached session checkout.
  useEffect(() => {
    if (sessionId && worktreePath && onWorktreeInfo) void refresh(projectPath).catch(() => {})
  }, [sessionId, worktreePath, projectPath, onWorktreeInfo, refresh])

  useEffect(() => {
    const prev = turnRef.current
    const next = { sessionId, streaming }
    turnRef.current = next
    if (gitTurnEnded(prev, next)) void refresh(projectPath, true).catch(() => {})
  }, [sessionId, streaming, refresh])

  return { gitInfo, refresh, replace }
}
