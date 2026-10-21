import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { loadEnvironmentItems, subscribeEnvironmentList } from '@/lib/environment-list'
import { onHostProjectsChanged } from '@/lib/host-projects-bus'
import { loadEnvironmentCatalog } from '@/lib/multi-host/catalog'
import type { EnvironmentBucket } from '@/lib/multi-host/types'
import { useAppStore } from '@/stores/app'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'

function keepOfflineCheckouts(previous: EnvironmentBucket[], next: EnvironmentBucket[]): EnvironmentBucket[] {
  return next.map((bucket) => {
    if (bucket.connection !== 'offline' || bucket.checkouts.length > 0) return bucket
    const prior = previous.find((item) => item.environmentId === bucket.environmentId)
    if (!prior?.checkouts.length) return bucket
    return { ...bucket, checkouts: prior.checkouts, projectsStatus: 'ready' as const, projectsError: null }
  })
}

/**
 * Fills the multi-host catalog while the remote-nodes flag is on.
 * Offline and explicitly disconnected nodes are not dialed.
 */
export function useLoadMultiHostCatalog(enabled: boolean): () => void {
  const { t } = useTranslation()
  const recentFolders = useAppStore((state) => state.recentFolders)
  const localLabel = window.app.platform === 'darwin' ? t('sidebar.thisMac') : t('sidebar.thisPc')

  useEffect(() => {
    if (!enabled) {
      useMultiHostSidebarStore.setState({ environments: [] })
      return
    }
    let cancelled = false
    const load = () => {
      void loadEnvironmentCatalog({
        remoteEnabled: true,
        localLabel,
        localFolders: recentFolders,
        listItems: () => loadEnvironmentItems(),
        listProjects: (connectionId, options) => window.environment.listProjects(connectionId, options),
      }).then((buckets) => {
        if (cancelled) return
        const previous = useMultiHostSidebarStore.getState().environments
        useMultiHostSidebarStore.getState().replaceEnvironments(keepOfflineCheckouts(previous, buckets))
      }).catch(() => {
        if (!cancelled) useMultiHostSidebarStore.getState().replaceEnvironments([])
      })
    }
    load()
    const unsubList = subscribeEnvironmentList(load)
    const unsubProjects = onHostProjectsChanged(load)
    return () => {
      cancelled = true
      unsubList()
      unsubProjects()
    }
  }, [enabled, localLabel, recentFolders])

  return () => {
    if (!enabled) return
    void loadEnvironmentCatalog({
      remoteEnabled: true,
      localLabel,
      localFolders: useAppStore.getState().recentFolders,
      listItems: () => loadEnvironmentItems(),
      listProjects: (connectionId, options) => window.environment.listProjects(connectionId, options),
    }).then((buckets) => {
      const previous = useMultiHostSidebarStore.getState().environments
      useMultiHostSidebarStore.getState().replaceEnvironments(keepOfflineCheckouts(previous, buckets))
    })
  }
}
