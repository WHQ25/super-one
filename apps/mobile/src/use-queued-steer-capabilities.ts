import { useCallback, useRef, useState } from 'react'
import type { HarnessId } from '@superone/shared/agent-types'
import type { HarnessRuntimeCapabilities } from '@superone/shared/harness/session-catalog'
import { canSteerQueued, canSteerQueuedSoon } from './queued-send'

/** Keep native controls and publish-time WebView flags on the same runtime facts. */
export function useQueuedSteerCapabilities(harness: HarnessId, acpAgentId?: string | null, scopeKey?: string) {
  const [facts, setFacts] = useState<{ scopeKey?: string; runtime?: HarnessRuntimeCapabilities }>()
  const runtime = facts?.scopeKey === scopeKey ? facts?.runtime : undefined
  const owner = useRef({ harness, acpAgentId, scopeKey })
  owner.current = { harness, acpAgentId, scopeKey }
  const current = { now: canSteerQueued(harness, runtime), soon: canSteerQueuedSoon(harness, acpAgentId, runtime) }
  const ref = useRef(current)
  ref.current = current
  const sync = useCallback((next: HarnessRuntimeCapabilities | undefined) => {
    ref.current = { now: canSteerQueued(owner.current.harness, next), soon: canSteerQueuedSoon(owner.current.harness, owner.current.acpAgentId, next) }
    const scope = owner.current.scopeKey
    setFacts((previous) => previous?.scopeKey === scope && previous?.runtime?.harnessId === next?.harnessId
      && previous?.runtime?.supportsQueuedSteer === next?.supportsQueuedSteer
      && previous?.runtime?.supportsQueuedSteerSoon === next?.supportsQueuedSteerSoon
      && previous?.runtime?.supportsStreamingToolInput === next?.supportsStreamingToolInput ? previous : { scopeKey: scope, runtime: next })
  }, [])
  return { ...current, ref, sync }
}
