import { checkoutFromSnapshot } from './catalog'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'

/** Reload one environment's projects. Offline buckets are left untouched. */
export async function refreshEnvironmentCheckouts(connectionId: string): Promise<void> {
  const projects = await window.environment.listProjects(connectionId, { refresh: true })
  const state = useMultiHostSidebarStore.getState()
  state.replaceEnvironments(state.environments.map((bucket) => {
    if (bucket.connectionId !== connectionId) return bucket
    return {
      ...bucket,
      projectsStatus: 'ready' as const,
      projectsError: null,
      checkouts: projects.map((project) => checkoutFromSnapshot(bucket.environmentId, bucket.connectionId, project)),
    }
  }))
}
