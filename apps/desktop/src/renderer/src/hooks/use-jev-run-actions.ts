import type { JevRunAction } from '@superone/shared/agent-types'
import type { RunContinuation } from '@superone/chat-view/presenters/run-display'
import { useChatStore } from '@/stores/chat-store'

/**
 * The rows a `*_run` block shows for the call still in flight: the store's
 * latest segment for that run.
 *
 * A finished call has its steps in its own result; only the open one needs
 * the live events. A resume call names its run in its input; the call that
 * started a run has no id yet, so it is the session's active run — a session
 * runs one at a time. All three platforms read it the same way.
 */
export function useJevRunActions(isRun: boolean, runId: string | undefined): JevRunAction[] | undefined {
  return useChatStore((state): JevRunAction[] | undefined => {
    if (!isRun || !state.activeProject) return undefined
    const project = state.projectSessions[state.activeProject]
    const sessionId = project?._activeSessionId
    if (!sessionId) return undefined
    const session = project._sessions[sessionId]
    const id = runId ?? session?._activeJevRunId
    const segments = id ? session?.jevRuns[id]?.segments : undefined
    return segments?.[segments.length - 1]
  })
}

/** The run the latest folded resume call names, so the live rows attach to it. */
export function liveRunId(continuations: RunContinuation[] | undefined): string | undefined {
  const last = continuations?.[continuations.length - 1]
  if (!last) return undefined
  const match = /"runId"\s*:\s*"([^"]+)"/.exec(last.input)
  return match?.[1]
}
