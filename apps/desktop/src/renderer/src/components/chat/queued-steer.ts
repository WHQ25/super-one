import { useCallback, useEffect, useRef } from 'react'
import type { AgentStatus, HarnessId } from '@superone/shared/agent-types'
import { resolveHarnessCapabilities } from '@superone/shared/harness/harness-capabilities'
import type { HarnessRuntimeCapabilities } from '@superone/shared/harness/session-catalog'
import { useEnvironmentServes } from '@/hooks/use-environment-serves'

export const DOUBLE_ENTER_STEER_MS = 400

export function useCanSteerQueue(
  projectPath: string | null | undefined,
  harness: HarnessId,
  runtimeCapabilities: HarnessRuntimeCapabilities | undefined,
  status: AgentStatus,
): boolean {
  const served = useEnvironmentServes(projectPath, 'session.steer')
  return served && status === 'streaming' && resolveHarnessCapabilities(harness, runtimeCapabilities).supportsQueuedSteer
}

type SteerDispatch = (steer: boolean) => void

export function useDoubleEnterSteer(enabled: boolean) {
  const pending = useRef<{ dispatch: SteerDispatch; timer: ReturnType<typeof setTimeout> } | null>(null)
  const flush = useCallback((steer: boolean) => {
    const current = pending.current
    if (!current) return false
    pending.current = null
    clearTimeout(current.timer)
    current.dispatch(steer)
    return true
  }, [])
  useEffect(() => () => { flush(false) }, [flush])
  const submit = useCallback((dispatch: SteerDispatch, hold: boolean) => {
    flush(false)
    if (!enabled || !hold) {
      dispatch(false)
      return
    }
    pending.current = { dispatch, timer: setTimeout(() => flush(false), DOUBLE_ENTER_STEER_MS) }
  }, [enabled, flush])
  const steer = useCallback(() => flush(true), [flush])
  return { submit, steer }
}
