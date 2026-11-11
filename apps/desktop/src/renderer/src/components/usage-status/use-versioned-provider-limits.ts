import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProviderRateLimits } from '@superone/shared/agent-types'
import { USAGE_POLL_MS } from '@superone/shared/subscription-usage'
import { FORCE_REFRESH_ON_OPEN_STALE_MS } from './rate-limit-tip'

export function useRefetchOnTurnEnd(status: string, fetchLimits: () => void) {
  const prevStatusRef = useRef(status)
  useEffect(() => {
    fetchLimits()
  }, [fetchLimits])
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev === 'streaming' && status === 'idle') fetchLimits()
    if (prev !== 'streaming' && status === 'streaming') fetchLimits()
  }, [status, fetchLimits])
  useEffect(() => {
    if (status !== 'streaming') return
    const timer = window.setInterval(fetchLimits, USAGE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [status, fetchLimits])
}

export function useVersionedProviderLimits(
  load: (force: boolean) => Promise<ProviderRateLimits | null>,
  status: string,
) {
  const [limits, setLimits] = useState<ProviderRateLimits | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const requestVersion = useRef(0)

  useEffect(() => {
    requestVersion.current++
    setLimits(null)
    setRefreshing(false)
    return () => {
      requestVersion.current++
    }
  }, [load])

  const requestLimits = useCallback(async (force: boolean) => {
    const version = ++requestVersion.current
    if (force) setRefreshing(true)
    try {
      const next = await load(force)
      if (version === requestVersion.current) setLimits(next)
    } catch {
      void 0
    } finally {
      if (version === requestVersion.current && force) setRefreshing(false)
    }
  }, [load])

  const fetchLimits = useCallback(() => {
    void requestLimits(false)
  }, [requestLimits])

  const refresh = useCallback(() => {
    void requestLimits(true)
  }, [requestLimits])

  const refreshIfStale = useCallback(() => {
    const fetchedAt = limits?.fetchedAt
    if (fetchedAt == null || Date.now() - fetchedAt > FORCE_REFRESH_ON_OPEN_STALE_MS) refresh()
  }, [limits?.fetchedAt, refresh])

  useRefetchOnTurnEnd(status, fetchLimits)

  return { limits, refreshing, fetchLimits, refresh, refreshIfStale }
}
