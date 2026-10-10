import { useState } from 'react'
import type { OpenCodeAgentOption, SandboxInfo, SessionGoal } from '@superone/shared/agent-types'
import type { LiveRateLimit } from '../harness-usage'
import type { ChatRuntime, SessionWorktreeFacts } from '../runtime'

export type SessionIndicatorSource = Pick<ChatRuntime,
  'sandboxInfo' | 'worktree' | 'contextTokens' | 'contextWindow' | 'totalCostUsd'
> & {
  session: Pick<ChatRuntime['session'], 'sessionGoal' | 'sessionAgents' | '_worktreeRemoved' | 'rateLimitInfo'>
}

/** Native readouts belong to the runtime being viewed, including during transitions. */
export function useSessionIndicators() {
  const [sandboxInfo, setSandboxInfo] = useState<SandboxInfo | null>(null)
  const [sessionGoal, setSessionGoal] = useState<SessionGoal | null>(null)
  /** Project-defined agents supplement the host's harness catalog. */
  const [sessionAgents, setSessionAgents] = useState<OpenCodeAgentOption[] | null>(null)
  const [sessionWorktree, setSessionWorktree] = useState<SessionWorktreeFacts & { removed: boolean }>(
    { isWorktree: false, worktreePath: null, gitBranch: null, removed: false },
  )
  const [usage, setUsage] = useState({ contextTokens: 0, contextWindow: null as number | null, totalCostUsd: 0 })
  /** A live limit tints the meter before its next polled reading. */
  const [rateLimit, setRateLimit] = useState<LiveRateLimit | null>(null)

  const sync = (runtime: SessionIndicatorSource) => {
    setSandboxInfo(runtime.sandboxInfo)
    setSessionGoal(runtime.session.sessionGoal)
    setSessionAgents(runtime.session.sessionAgents)
    setSessionWorktree((current) => {
      const next = { ...runtime.worktree, removed: runtime.session._worktreeRemoved }
      return current.isWorktree === next.isWorktree && current.worktreePath === next.worktreePath
        && current.gitBranch === next.gitBranch && current.removed === next.removed
        ? current : next
    })
    setUsage((current) => (
      current.contextTokens === runtime.contextTokens && current.contextWindow === runtime.contextWindow
        && current.totalCostUsd === runtime.totalCostUsd
        ? current
        : { contextTokens: runtime.contextTokens, contextWindow: runtime.contextWindow, totalCostUsd: runtime.totalCostUsd }
    ))
    setRateLimit(runtime.session.rateLimitInfo)
  }

  const reset = () => {
    setSandboxInfo(null)
    setSessionGoal(null)
    setSessionAgents(null)
    setSessionWorktree({ isWorktree: false, worktreePath: null, gitBranch: null, removed: false })
    setUsage({ contextTokens: 0, contextWindow: null, totalCostUsd: 0 })
    setRateLimit(null)
  }

  return { sandboxInfo, sessionGoal, sessionAgents, sessionWorktree, usage, rateLimit, sync, reset }
}
