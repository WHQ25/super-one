import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { ShellGitInfo } from '../project-types'
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
}) {
  const { clientRef, projectPath, sessionId, streaming } = opts
  const [gitInfo, setGitInfo] = useState<ShellGitInfo | null>(null)
  const generation = useRef(0)
  const turnRef = useRef({ sessionId, streaming })

  const refresh = useCallback(async (path: string | null | undefined = projectPath) => {
    const client = clientRef.current
    if (!client || !path) return
    const request = ++generation.current
    const git = await fetchProjectGitInfo(client, path)
    if (request !== generation.current) return
    setGitInfo(git)
  }, [clientRef, projectPath])

  const replace = useCallback((git: ShellGitInfo | null) => {
    generation.current += 1
    setGitInfo(git)
  }, [])

  useEffect(() => {
    const prev = turnRef.current
    const next = { sessionId, streaming }
    turnRef.current = next
    if (gitTurnEnded(prev, next)) void refresh().catch(() => {})
  }, [sessionId, streaming, refresh])

  return { gitInfo, refresh, replace }
}
