import { useEffect, useState } from 'react'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { loadEnvironmentItems, subscribeEnvironmentList } from '@/lib/environment-list'
import { catalogFromHarnessIds, type HarnessCatalogStatus } from '@/lib/harness-visibility'
import { useChatStore, useSessionScope } from '@/stores/chat'

/**
 * The harness catalog of the machine that runs the pane's project: this
 * desktop's own (`localCatalog`), or a node's from its descriptor, read again
 * whenever that node connects. Null while a node's descriptor is unknown.
 */
export function useProjectHarnessCatalog(localCatalog: HarnessCatalogStatus[] | null): HarnessCatalogStatus[] | null {
  const scope = useSessionScope()
  const projectPath = useChatStore((s) => scope?.projectPath ?? s.activeProject)
  const connectionId = projectPath ? parseRemoteProjectKey(projectPath)?.connectionId ?? null : null
  const [remote, setRemote] = useState<{ connectionId: string; catalog: HarnessCatalogStatus[] } | null>(null)
  useEffect(() => {
    if (!connectionId) return
    let cancelled = false
    const read = () => {
      void loadEnvironmentItems().then((items) => {
        const harnessIds = items.find((item) => item.connectionId === connectionId)?.capabilities?.harnessIds
        if (!cancelled && harnessIds) setRemote({ connectionId, catalog: catalogFromHarnessIds(harnessIds) })
      }).catch(() => {})
    }
    read()
    // Status handling lives in the shared list: this hook must not subscribe
    // itself, or a one-listener test mock would drop the cache's bridge.
    const unsubscribe = subscribeEnvironmentList(read)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [connectionId])
  if (!connectionId) return localCatalog
  return remote?.connectionId === connectionId ? remote.catalog : null
}
