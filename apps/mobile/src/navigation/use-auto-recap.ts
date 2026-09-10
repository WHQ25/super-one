import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { RelayClient } from '@superone/relay-client'
import { createMobileAutoRecap, requestAutoSessionRecap } from '../auto-recap'

/** Grok auto recap: session switch and app background/inactive both count as away. */
export function useAutoRecap(opts: {
  clientRef: { current: RelayClient | null }
  sessionId: string | null
  projectPath: string | null
  eligible: boolean
}): { markRecapShown: (sessionId: string) => void } {
  const recapRef = useRef<ReturnType<typeof createMobileAutoRecap> | null>(null)
  const clientRef = opts.clientRef
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active')

  useEffect(() => {
    const recap = createMobileAutoRecap({
      requestAutoRecap: async (sessionId, projectPath) => {
        const client = clientRef.current
        if (!client) return false
        return requestAutoSessionRecap((cmd) => client.request(cmd), sessionId, projectPath)
      },
    })
    recapRef.current = recap
    return () => {
      recap.dispose()
      recapRef.current = null
    }
  }, [clientRef])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setAppActive(next === 'active')
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    recapRef.current?.sync(
      opts.sessionId && opts.projectPath
        ? { sessionId: opts.sessionId, projectPath: opts.projectPath }
        : null,
      appActive,
      opts.eligible,
    )
  }, [opts.sessionId, opts.projectPath, opts.eligible, appActive])

  const markRecapShown = useCallback((sessionId: string) => {
    recapRef.current?.markRecapShown(sessionId)
  }, [])

  return { markRecapShown }
}
