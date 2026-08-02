import { useCallback, useEffect, useState } from 'react'
import type { RecentFolder } from '@superone/shared/agent-types'
import type { SupervisorSnapshot } from '@superone/shared/environment'
import { remoteProjectKey } from '@/lib/remote-project-key'
import { onHostProjectsChanged } from '@/lib/host-projects-bus'
import { useAppStore } from '@/stores/app'

/**
 * Project list for the currently selected host.
 *
 * Local → `recentFolders` from the desktop recents store.
 * Remote → auto-connect + `environment.listProjects`, keyed as
 * `remote:<connectionId>:<hostPath>` so chat/sidebar state never collides
 * with a local path of the same string.
 */
export function useHostProjects() {
  const selectedHostConnectionId = useAppStore((s) => s.selectedHostConnectionId)
  const recentFolders = useAppStore((s) => s.recentFolders)
  const [remoteProjects, setRemoteProjects] = useState<RecentFolder[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  const isLocal = selectedHostConnectionId === 'local'

  useEffect(() => {
    let cancelled = false

    if (isLocal) {
      setRemoteProjects([])
      setError(null)
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const items = await window.environment.listItems()
        if (cancelled) return
        const host = items.find((h) => h.connectionId === selectedHostConnectionId)
        const live = host?.state === 'connected' || host?.state === 'synchronizing'
        if (!live) {
          await window.environment.connect(selectedHostConnectionId)
        }
        if (cancelled) return
        const projects = await window.environment.listProjects(selectedHostConnectionId)
        if (cancelled) return
        setRemoteProjects(
          projects.map((p) => ({
            id: p.projectId,
            path: remoteProjectKey(selectedHostConnectionId, p.path),
            name: p.name,
            missing: p.missing,
            addedAt: p.lastActiveAt
              ? new Date(p.lastActiveAt).toISOString()
              : new Date(0).toISOString(),
            lastOpened: p.lastActiveAt
              ? new Date(p.lastActiveAt).toISOString()
              : new Date(0).toISOString(),
          })),
        )
      } catch (err) {
        if (cancelled) return
        setRemoteProjects([])
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isLocal, selectedHostConnectionId, retryNonce])

  useEffect(() => {
    if (isLocal) return
    return window.environment.onStatusEvent((snapshot: SupervisorSnapshot) => {
      if (
        snapshot.connectionId === selectedHostConnectionId
        && snapshot.state === 'connected'
      ) {
        setRetryNonce((nonce) => nonce + 1)
      }
    })
  }, [isLocal, selectedHostConnectionId])

  // Sidebar remove/add project must refresh ChatSuggestions (separate hook instance).
  useEffect(() => {
    if (isLocal) return
    return onHostProjectsChanged(() => setRetryNonce((n) => n + 1))
  }, [isLocal])

  const refresh = useCallback(() => setRetryNonce((n) => n + 1), [])

  return {
    connectionId: selectedHostConnectionId,
    isLocal,
    projects: isLocal ? recentFolders : remoteProjects,
    loading: isLocal ? false : loading,
    error: isLocal ? null : error,
    refresh,
  }
}
