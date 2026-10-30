import { loadEnvironmentItems, subscribeEnvironmentList } from '@/lib/environment-list'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
import { environmentBucketsWithLabels } from './catalog'

/**
 * The settings page unmounts the sidebar, so a rename there has no catalog
 * listener. This one stays up and copies the stored name onto the buckets the
 * sidebar and the workdir chip already render. It does not reload projects.
 */
let unsubscribe: (() => void) | null = null

export function startEnvironmentLabelSync(): void {
  if (unsubscribe) return
  unsubscribe = subscribeEnvironmentList(() => {
    void loadEnvironmentItems().then((items) => {
      const state = useMultiHostSidebarStore.getState()
      const next = environmentBucketsWithLabels(state.environments, items)
      if (next !== state.environments) state.replaceEnvironments(next)
    }).catch(() => {})
  })
}

/** Test isolation. Production never calls this. */
export function resetEnvironmentLabelSyncForTests(): void {
  unsubscribe?.()
  unsubscribe = null
}
