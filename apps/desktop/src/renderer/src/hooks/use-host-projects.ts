import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecentFolder } from '@superone/shared/agent-types'
import type { SupervisorSnapshot } from '@superone/shared/environment'
import { remoteProjectKey } from '@/lib/remote-project-key'
import { onHostProjectsChanged } from '@/lib/host-projects-bus'
import { useAppStore } from '@/stores/app'

export interface UseHostProjectsOptions {
  /**
   * Skip loading while the host's socket is expected to bounce (e.g. a node CLI
   * upgrade). Connecting mid-restart only surfaces a transient error.
   */
  paused?: boolean
}

export interface UseHostProjectsResult {
  connectionId: string
  isLocal: boolean
  projects: RecentFolder[]
  loading: boolean
  error: string | null
  /** Re-run the load. `force` bypasses the main-process project cache. */
  refresh: (options?: { force?: boolean }) => void
}

/**
 * Project list for the currently selected host — the single source for the
 * sidebar, ChatSuggestions and ProjectSelector. Do not re-implement this fetch
 * locally: three near-identical copies are exactly how the pickers drifted out
 * of sync (sidebar populated, chat dropdown empty).
 *
 * Local → `recentFolders` from the desktop recents store.
 * Remote → auto-connect + `environment.listProjects`, keyed as
 * `remote:<connectionId>:<hostPath>` so chat/sidebar state never collides
 * with a local path of the same string.
 */
export function useHostProjects(options?: UseHostProjectsOptions): UseHostProjectsResult {
  const paused = options?.paused ?? false
  const selectedHostConnectionId = useAppStore((s) => s.selectedHostConnectionId)
  const recentFolders = useAppStore((s) => s.recentFolders)
  const [remoteProjects, setRemoteProjects] = useState<RecentFolder[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  /** Consumed by the next load; a forced reload skips the main-process cache. */
  const forceNextRef = useRef(false)

  const isLocal = selectedHostConnectionId === 'local'

  // Host switch drops the previous host's list; a retry on the *same* host must
  // not, so this clearing lives in its own effect keyed only on the host id.
  useEffect(() => {
    setRemoteProjects([])
  }, [selectedHostConnectionId])

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

    if (paused) {
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const force = forceNextRef.current
        forceNextRef.current = false
        const items = await window.environment.listItems()
        if (cancelled) return
        const host = items.find((h) => h.connectionId === selectedHostConnectionId)
        const live = host?.state === 'connected' || host?.state === 'synchronizing'
        if (!live) {
          await window.environment.connect(selectedHostConnectionId)
        }
        if (cancelled) return
        const projects = await (force
          ? window.environment.listProjects(selectedHostConnectionId, { refresh: true })
          : window.environment.listProjects(selectedHostConnectionId))
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
        const message = err instanceof Error ? err.message : String(err)
        // Keep the last known good list. `environment.listProjects` bypasses the
        // main-process cache whenever the host snapshot is not `connected`, so a
        // mid-reconnect call throws — blanking here is what turns a transient
        // gateway hiccup into a permanently empty project picker.
        console.error(
          `[use-host-projects] listProjects failed host=${selectedHostConnectionId}: ${message}`,
        )
        setError(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isLocal, selectedHostConnectionId, retryNonce, paused])

  useEffect(() => {
    if (isLocal || paused) return
    return window.environment.onStatusEvent((snapshot: SupervisorSnapshot) => {
      // Every snapshot for this host is a reload edge: a load that started while
      // the host was still `synchronizing` can fail, and the host may never emit
      // another `connected` edge afterwards.
      if (snapshot.connectionId !== selectedHostConnectionId) return
      setRetryNonce((nonce) => nonce + 1)
    })
  }, [isLocal, selectedHostConnectionId, paused])

  // Add / remove project runs in one component but must refresh every instance.
  useEffect(() => {
    if (isLocal) return
    return onHostProjectsChanged(() => setRetryNonce((n) => n + 1))
  }, [isLocal])

  const refresh = useCallback((opts?: { force?: boolean }) => {
    if (opts?.force) forceNextRef.current = true
    setRetryNonce((n) => n + 1)
  }, [])

  return {
    connectionId: selectedHostConnectionId,
    isLocal,
    projects: isLocal ? recentFolders : remoteProjects,
    loading: isLocal ? false : loading,
    error: isLocal ? null : error,
    refresh,
  }
}
