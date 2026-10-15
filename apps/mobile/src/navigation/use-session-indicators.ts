import { useState } from 'react'
import type { OpenCodeAgentOption, SandboxInfo, SessionGoal } from '@superone/shared/agent-types'
import { sessionCacheExpiry, type SessionCacheExpiry } from '@superone/shared/session-continuation'
import type { LiveRateLimit } from '../harness-usage'
import type { ChatRuntime, SessionWorktreeFacts } from '../runtime'

export type SessionIndicatorSource = Pick<ChatRuntime,
  'sandboxInfo' | 'worktree' | 'contextTokens' | 'contextWindow' | 'totalCostUsd'
> & {
  session: Pick<ChatRuntime['session'], 'sessionGoal' | 'sessionAgents' | '_worktreeRemoved' | 'rateLimitInfo' | 'messages'>
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
  /** When an idle session's prompt cache expires; the continuation hint reads it. */
  const [cacheExpiry, setCacheExpiry] = useState<SessionCacheExpiry | null>(null)

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
    const expiry = sessionCacheExpiry({ messages: runtime.session.messages, contextTokens: runtime.contextTokens })
    setCacheExpiry((current) => current?.expiresAt === expiry?.expiresAt && current?.contextTokens === expiry?.contextTokens
      ? current : expiry)
  }

  const reset = () => {
    setSandboxInfo(null)
    setSessionGoal(null)
    setSessionAgents(null)
    setSessionWorktree({ isWorktree: false, worktreePath: null, gitBranch: null, removed: false })
    setUsage({ contextTokens: 0, contextWindow: null, totalCostUsd: 0 })
    setRateLimit(null)
    setCacheExpiry(null)
  }

  return { sandboxInfo, sessionGoal, sessionAgents, sessionWorktree, usage, rateLimit, cacheExpiry, sync, reset }
}
