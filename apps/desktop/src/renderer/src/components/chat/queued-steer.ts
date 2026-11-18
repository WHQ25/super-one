import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { AgentStatus, HarnessId } from '@superone/shared/agent-types'
import { resolveHarnessCapabilities } from '@superone/shared/harness/harness-capabilities'
import type { HarnessRuntimeCapabilities } from '@superone/shared/harness/session-catalog'
import { useEnvironmentServes } from '@/hooks/use-environment-serves'

export const DOUBLE_ENTER_STEER_MS = 400
export const QUEUED_SEND_DELAY_MS = 100

export function useCanSteerQueue(
  projectPath: string | null | undefined,
  harness: HarnessId,
  runtimeCapabilities: HarnessRuntimeCapabilities | undefined,
  status: AgentStatus,
): boolean {
  const served = useEnvironmentServes(projectPath, 'session.steer')
  return served && status === 'streaming' && resolveHarnessCapabilities(harness, runtimeCapabilities).supportsQueuedSteer
}

export function useDoubleEnterSteer(enabled: boolean) {
  const active = useRef<{
    dispatch: (steer: boolean) => void
    onSteer: () => void
    dispatched: boolean
    sendTimer: ReturnType<typeof setTimeout> | undefined
    windowTimer: ReturnType<typeof setTimeout>
  } | null>(null)

  const clear = useCallback(() => {
    const current = active.current
    if (!current) return null
    active.current = null
    if (current.sendTimer !== undefined) clearTimeout(current.sendTimer)
    clearTimeout(current.windowTimer)
    return current
  }, [])

  const disarm = useCallback(() => {
    const current = clear()
    if (current && !current.dispatched) current.dispatch(false)
  }, [clear])

  useEffect(() => {
    if (!enabled) disarm()
  }, [enabled, disarm])

  useEffect(() => disarm, [disarm])

  const submit = useCallback((dispatch: (steer: boolean) => void, onSteer: () => void, hold: boolean) => {
    disarm()
    if (!enabled || !hold) {
      dispatch(false)
      return
    }
    const entry = {
      dispatch,
      onSteer,
      dispatched: false,
      sendTimer: undefined as ReturnType<typeof setTimeout> | undefined,
      windowTimer: undefined as unknown as ReturnType<typeof setTimeout>,
    }
    entry.sendTimer = setTimeout(() => {
      entry.sendTimer = undefined
      if (active.current !== entry || entry.dispatched) return
      entry.dispatched = true
      entry.dispatch(false)
    }, QUEUED_SEND_DELAY_MS)
    entry.windowTimer = setTimeout(() => {
      if (active.current === entry) active.current = null
    }, DOUBLE_ENTER_STEER_MS)
    active.current = entry
  }, [enabled, disarm])

  const steer = useCallback(() => {
    if (!enabled) {
      disarm()
      return false
    }
    const current = clear()
    if (!current) return false
    if (!current.dispatched) {
      current.dispatched = true
      current.dispatch(true)
    } else {
      current.onSteer()
    }
    return true
  }, [enabled, clear, disarm])

  return useMemo(() => ({ submit, steer, disarm }), [submit, steer, disarm])
}
