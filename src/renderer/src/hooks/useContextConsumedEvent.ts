import { useEffect } from 'react'

export function useContextConsumedEvent(
  appId: string,
  send: (msg: unknown) => void,
  disabled?: boolean,
) {
  useEffect(() => {
    if (disabled) return
    const handler = (e: Event) => {
      const { appIds } = (e as CustomEvent).detail
      if (appIds.includes(appId)) {
        send({ type: 'miniapp-context-consumed' })
      }
    }
    window.addEventListener('miniapp-context-consumed', handler)
    return () => window.removeEventListener('miniapp-context-consumed', handler)
  }, [appId, send, disabled])
}
