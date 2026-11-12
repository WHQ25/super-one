import { useCallback, useRef, useState } from 'react'
import type { HarnessId } from '@superone/shared/agent-types'
import type { HarnessRuntimeCapabilities } from '@superone/shared/harness/session-catalog'
import { canSteerQueued } from './queued-send'

export function useQueuedSteerCapabilities(harness: HarnessId, scopeKey?: string) {
  const [facts, setFacts] = useState<{ scopeKey?: string; runtime?: HarnessRuntimeCapabilities }>()
  const runtime = facts?.scopeKey === scopeKey ? facts?.runtime : undefined
  const owner = useRef({ harness, scopeKey })
  owner.current = { harness, scopeKey }
  const canSteer = canSteerQueued(harness, runtime)
  const ref = useRef(canSteer)
  ref.current = canSteer
  const sync = useCallback((next: HarnessRuntimeCapabilities | undefined) => {
    ref.current = canSteerQueued(owner.current.harness, next)
    const scope = owner.current.scopeKey
    setFacts((previous) => previous?.scopeKey === scope && previous?.runtime?.harnessId === next?.harnessId
      && previous?.runtime?.supportsQueuedSteer === next?.supportsQueuedSteer
      && previous?.runtime?.supportsStreamingToolInput === next?.supportsStreamingToolInput ? previous : { scopeKey: scope, runtime: next })
  }, [])
  return { canSteer, ref, sync }
}
