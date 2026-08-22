import { useEffect } from 'react'

/**
 * Forwards "the agent consumed this mini-app's context card" to main, which
 * relays it to the MiniApp Hosts. The context API lives Node-side now, so the
 * WebView is no longer in this path — mount this once at the app root.
 */
export function useMiniAppContextConsumedRelay(): void {
  useEffect(() => {
    const handler = (event: Event) => {
      const { appIds } = (event as CustomEvent<{ appIds: string[] }>).detail
      if (Array.isArray(appIds) && appIds.length > 0) window.miniapp.notifyContextConsumed(appIds)
    }
    window.addEventListener('miniapp-context-consumed', handler)
    return () => window.removeEventListener('miniapp-context-consumed', handler)
  }, [])
}
