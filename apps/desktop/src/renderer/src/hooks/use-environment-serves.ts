import { useEffect, useState } from 'react'
import { servesMethod } from '@superone/shared/environment/capabilities'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { loadEnvironmentItems, subscribeEnvironmentList } from '@/lib/environment-list'

/**
 * Whether the machine holding `projectPath` serves `method` (its descriptor's
 * `methods`). This desktop's own projects always do; a remote one counts as
 * serving it until its descriptor says otherwise, so nothing flickers off.
 */
export function useEnvironmentServes(projectPath: string | null | undefined, method: string): boolean {
  const connectionId = projectPath ? parseRemoteProjectKey(projectPath)?.connectionId ?? null : null
  const [served, setServed] = useState<{ connectionId: string; method: string; serves: boolean } | null>(null)
  useEffect(() => {
    if (!connectionId) return
    let cancelled = false
    const read = () => {
      void loadEnvironmentItems().then((items) => {
        const capabilities = items.find((item) => item.connectionId === connectionId)?.capabilities
        if (!cancelled && capabilities) setServed({ connectionId, method, serves: servesMethod(capabilities, method) })
      }).catch(() => {})
    }
    read()
    const unsubscribe = subscribeEnvironmentList(read)
    return () => { cancelled = true; unsubscribe() }
  }, [connectionId, method])
  if (!connectionId) return true
  return served?.connectionId === connectionId && served.method === method ? served.serves : true
}
