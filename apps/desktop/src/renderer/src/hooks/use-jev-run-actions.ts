import type { JevRunAction } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat-store'

/**
 * The actions a `*_run` block should show.
 *
 * A finished run names itself in its own result; one still in flight does not
 * have a result yet, so it is the session's active run — a session runs one at
 * a time. All three platforms read it the same way.
 */
export function useJevRunActions(isRun: boolean, runId: string | undefined): JevRunAction[] | undefined {
  return useChatStore((state): JevRunAction[] | undefined => {
    if (!isRun || !state.activeProject) return undefined
    const project = state.projectSessions[state.activeProject]
    const sessionId = project?._activeSessionId
    if (!sessionId) return undefined
    const session = project._sessions[sessionId]
    const id = runId ?? session?._activeJevRunId
    return id ? session?.jevRuns[id]?.actions : undefined
  })
}
