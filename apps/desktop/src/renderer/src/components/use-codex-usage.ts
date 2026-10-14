import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodexAccountUsage, CodexRateLimits } from '@superone/shared/agent-types'

export function useCodexUsage(projectPath: string, apiProviderId: string | null, threadId: string | null) {
  const [limits, setLimits] = useState<CodexRateLimits | null>(null)
  const [usage, setUsage] = useState<CodexAccountUsage | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const requestVersion = useRef(0)

  const request = useCallback(async (force: boolean) => {
    const version = ++requestVersion.current
    if (force) setRefreshing(true)
    await Promise.allSettled([
      window.app.codexGetRateLimits(projectPath, apiProviderId, force).then((next) => {
        if (version === requestVersion.current) setLimits(next)
      }),
      window.app.codexGetAccountUsage(projectPath, apiProviderId, threadId, force).then((next) => {
        if (version === requestVersion.current) setUsage(next)
      }),
    ])
    if (version === requestVersion.current) { setLoaded(true); setRefreshing(false) }
  }, [projectPath, apiProviderId, threadId])

  useEffect(() => {
    setLimits(null)
    setUsage(null)
    setLoaded(false)
    setRefreshing(false)
    return () => { requestVersion.current++ }
  }, [projectPath, apiProviderId])

  // The thread estimate changes with the session; subscription quota belongs to the account.
  useEffect(() => { setUsage(null) }, [threadId])
  const fetchLimits = useCallback(() => { void request(false) }, [request])
  const refresh = useCallback(() => { void request(true) }, [request])
  return { limits, usage, loaded, refreshing, fetchLimits, refresh }
}
