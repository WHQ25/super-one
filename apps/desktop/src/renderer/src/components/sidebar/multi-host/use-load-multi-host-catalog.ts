import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { loadEnvironmentItems, subscribeEnvironmentList } from '@/lib/environment-list'
import { onHostProjectsChanged } from '@/lib/host-projects-bus'
import { applyCatalogBucket, catalogLoads, loadEnvironmentCatalog, shareProjectLoad } from '@/lib/multi-host/catalog'
import type { EnvironmentBucket } from '@/lib/multi-host/types'
import { useAppStore } from '@/stores/app'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'

function upsertBucket(bucket: EnvironmentBucket): void {
  const store = useMultiHostSidebarStore.getState()
  store.replaceEnvironments(applyCatalogBucket(store.environments, bucket))
}

function localErrorBucket(label: string, message: string): EnvironmentBucket {
  return {
    environmentId: 'local',
    connectionId: 'local',
    label,
    kind: 'local',
    connection: 'connected',
    projectsStatus: 'error',
    projectsError: message,
    checkouts: [],
  }
}

/**
 * Fills the multi-host catalog while the remote-nodes flag is on.
 * Offline, disconnected, and connecting nodes are not dialed. A newer load
 * ignores buckets from an older one. The list is not cleared at the start.
 */
export function useLoadMultiHostCatalog(enabled: boolean): void {
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
      const ticket = catalogLoads.next()
      void loadEnvironmentCatalog({
        remoteEnabled: true,
        localLabel,
        localFolders: recentFolders,
        listItems: () => loadEnvironmentItems(),
        listProjects: (connectionId, options) => shareProjectLoad(
          connectionId,
          () => window.environment.listProjects(connectionId, options),
        ),
        onBucket: (bucket) => {
          if (cancelled || !ticket.current()) return
          upsertBucket(bucket)
        },
      }).then((buckets) => {
        if (cancelled || !ticket.current()) return
        useMultiHostSidebarStore.getState().replaceEnvironments(buckets)
      }).catch((err: unknown) => {
        if (cancelled || !ticket.current()) return
        const previous = useMultiHostSidebarStore.getState().environments
        if (previous.length > 0) return
        const message = err instanceof Error ? err.message : String(err)
        useMultiHostSidebarStore.getState().replaceEnvironments([localErrorBucket(localLabel, message)])
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
}
