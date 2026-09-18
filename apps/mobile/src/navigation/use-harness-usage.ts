import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { HarnessId, RemoteUsage } from '@superone/shared/agent-types'
import { consumeRateLimitReset, fetchHarnessUsage, usageIsStale, usageTargetKey, type LiveRateLimit, type UsageTarget } from '../harness-usage'
import type { UsageMeterProps } from '../ui/usage-panel'

/**
 * Live subscription meter for the credential the open session bills.
 *
 * Refresh points mirror the desktop gauge: the credential changing, a turn
 * starting (the runtime is definitely up by then, which covers a Grok prefetch
 * that had not answered on first mount) and a turn ending (the reading just
 * moved). The host throttles upstream calls itself, so these reads are cheap;
 * `refresh()` is the one place that forces a fresh reading, for a panel the
 * user has just opened on a stale meter.
 *
 * Readings are kept per credential key, so coming back to a credential shows
 * its last reading at once while the host confirms it, instead of a blank meter.
 */
export function useHarnessUsage(opts: {
  clientRef: RefObject<RelayClient | null>
  target: UsageTarget | null
  streaming: boolean
}) {
  const { clientRef, target, streaming } = opts
  const [usage, setUsage] = useState<RemoteUsage | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const generation = useRef(0)
  const targetRef = useRef(target)
  targetRef.current = target
  const usageRef = useRef(usage)
  usageRef.current = usage
  const cache = useRef(new Map<string, RemoteUsage>())
  const key = usageTargetKey(target)

  const read = useCallback(async (force: boolean) => {
    const client = clientRef.current
    const current = targetRef.current
    if (!client || !current) return
    const request = ++generation.current
    const next = await fetchHarnessUsage(client, current, force)
    const currentKey = usageTargetKey(current)
    if (currentKey) {
      if (next) cache.current.set(currentKey, next)
      else cache.current.delete(currentKey)
    }
    if (request !== generation.current) return
    setUsage(next)
  }, [clientRef])

  /** Force a fresh reading: the manual button, and after redeeming a credit. */
  const reload = useCallback(async () => {
    setRefreshing(true)
    try { await read(true) } finally { setRefreshing(false) }
  }, [read])

  /** Force a fresh reading only when the one on screen is old enough to mislead. */
  const refresh = useCallback(async () => {
    if (usageIsStale(usageRef.current)) await reload()
  }, [reload])

  useEffect(() => {
    generation.current += 1
    setUsage(key ? cache.current.get(key) ?? null : null)
    if (key) void read(false)
  }, [key, read])

  const streamingRef = useRef(streaming)
  useEffect(() => {
    const was = streamingRef.current
    streamingRef.current = streaming
    if (was !== streaming && key) void read(false)
  }, [streaming, key, read])

  return { usage, refreshing, refresh, reload }
}

/**
 * The composer's meter, assembled from the shell's selection state. The target
 * names the credential the way the composer does, so switching account or
 * harness on the landing re-reads before the session exists.
 *
 * Opening a session resets the selection to `apiProviderId: null` until its
 * catalog answers. That `null` means "unknown", not "default credential", so
 * while the catalog is pending the previous credential id is carried over as
 * long as the harness is the same — otherwise every session switch would look
 * like a change of credential and blank the meter twice.
 */
export function useComposerUsage(opts: {
  clientRef: RefObject<RelayClient | null>
  projectPath: string | null | undefined
  provider: HarnessId
  sessionId: string | null
  apiProviderId: string | null
  acpAgentId: string | null
  catalogReady: boolean
  streaming: boolean
  rateLimit: LiveRateLimit | null
}): UsageMeterProps {
  const { clientRef, projectPath, provider, sessionId, apiProviderId, acpAgentId, catalogReady, streaming, rateLimit } = opts
  const last = useRef<{ provider: HarnessId; acpAgentId: string | null; apiProviderId: string | null } | null>(null)
  const resolvedProviderId = !catalogReady && last.current?.provider === provider && last.current.acpAgentId === acpAgentId
    ? last.current.apiProviderId
    : apiProviderId
  last.current = { provider, acpAgentId, apiProviderId: resolvedProviderId }
  const target = useMemo<UsageTarget | null>(
    () => projectPath ? { projectPath, provider, sessionId, apiProviderId: resolvedProviderId, acpAgentId } : null,
    [projectPath, provider, sessionId, resolvedProviderId, acpAgentId],
  )
  const { usage, refreshing, refresh, reload } = useHarnessUsage({ clientRef, target, streaming })
  const onConsumeResetCredit = useCallback(async (creditId: string | null) => {
    const client = clientRef.current
    if (!client || !target) return null
    const outcome = await consumeRateLimitReset(client, target, creditId)
    void reload()
    return outcome
  }, [clientRef, target, reload])
  return useMemo(() => ({
    usage, refreshing, rateLimit,
    onOpen: () => { void refresh() },
    onRefresh: () => { void reload() },
    onConsumeResetCredit,
  }), [usage, refreshing, rateLimit, refresh, reload, onConsumeResetCredit])
}
