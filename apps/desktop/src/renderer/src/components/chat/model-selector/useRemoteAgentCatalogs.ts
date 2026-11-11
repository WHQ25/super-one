import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionAgentProfile } from '@superone/shared/agent-types'

/** One machine's agent catalog as the collaboration confirm card loads it. */
export type RemoteAgentCatalog =
  | { status: 'loading' }
  | { status: 'ready'; profiles: SessionAgentProfile[] }
  /** The machine runs a version that cannot list its catalog; children use its defaults. */
  | { status: 'unsupported' }
  | { status: 'error'; message: string }

const LOADING: RemoteAgentCatalog = { status: 'loading' }

/**
 * The agent catalogs of the machines remote launches target, keyed by
 * environmentId, from each machine's own configuration.
 * `retry` reloads one after an error. `refresh` re-probes past the catalog cache
 * and keeps the models already on screen.
 */
export function useRemoteAgentCatalogs(environmentIds: readonly string[]): {
  catalogs: Readonly<Record<string, RemoteAgentCatalog>>
  retry: (environmentId: string) => void
  refresh: (environmentId: string) => void
  refreshing: Readonly<Record<string, boolean>>
} {
  const [catalogs, setCatalogs] = useState<Record<string, RemoteAgentCatalog>>({})
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({})
  // Latest request per machine: a retry's answer must not lose to an older one.
  const requests = useRef(new Map<string, number>())
  const catalogsRef = useRef(catalogs)
  catalogsRef.current = catalogs

  const load = useCallback((environmentId: string, force = false) => {
    const request = (requests.current.get(environmentId) ?? 0) + 1
    requests.current.set(environmentId, request)
    const keepVisible = force && catalogsRef.current[environmentId]?.status === 'ready'
    if (!keepVisible) setCatalogs((current) => ({ ...current, [environmentId]: LOADING }))
    setRefreshing((current) => ({ ...current, [environmentId]: force }))
    const fetchProfiles = window.environment?.remoteAgentProfiles
    Promise.resolve()
      .then(() => {
        if (typeof fetchProfiles !== 'function') throw new Error('remote agent profiles are unavailable')
        // Omit force unless it is a refresh, so a normal open stays a one-argument read.
        return force ? fetchProfiles(environmentId, true) : fetchProfiles(environmentId)
      })
      .then((result) => {
        if (requests.current.get(environmentId) !== request) return
        setCatalogs((current) => ({
          ...current,
          [environmentId]: result.supported ? { status: 'ready', profiles: result.profiles } : { status: 'unsupported' },
        }))
      })
      .catch((error: unknown) => {
        if (requests.current.get(environmentId) !== request) return
        const message = error instanceof Error ? error.message : String(error)
        setCatalogs((current) => {
          if (force && current[environmentId]?.status === 'ready') return current
          return { ...current, [environmentId]: { status: 'error', message } }
        })
      })
      .finally(() => {
        if (requests.current.get(environmentId) !== request) return
        setRefreshing((current) => ({ ...current, [environmentId]: false }))
      })
  }, [])

  const key = [...new Set(environmentIds)].sort().join('\n')
  useEffect(() => {
    if (key) for (const environmentId of key.split('\n')) load(environmentId)
  }, [key, load])

  const refresh = useCallback((environmentId: string) => load(environmentId, true), [load])
  return { catalogs, retry: (environmentId) => load(environmentId), refresh, refreshing }
}
