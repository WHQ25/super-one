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
 * environmentId, from each machine's own configuration. `retry` reloads one.
 */
export function useRemoteAgentCatalogs(environmentIds: readonly string[]): {
  catalogs: Readonly<Record<string, RemoteAgentCatalog>>
  retry: (environmentId: string) => void
} {
  const [catalogs, setCatalogs] = useState<Record<string, RemoteAgentCatalog>>({})
  // Latest request per machine: a retry's answer must not lose to an older one.
  const requests = useRef(new Map<string, number>())

  const load = useCallback((environmentId: string) => {
    const request = (requests.current.get(environmentId) ?? 0) + 1
    requests.current.set(environmentId, request)
    const settle = (catalog: RemoteAgentCatalog) => {
      if (requests.current.get(environmentId) !== request) return
      setCatalogs((current) => ({ ...current, [environmentId]: catalog }))
    }
    settle(LOADING)
    const fetchProfiles = window.environment?.remoteAgentProfiles
    Promise.resolve()
      .then(() => {
        if (typeof fetchProfiles !== 'function') throw new Error('remote agent profiles are unavailable')
        return fetchProfiles(environmentId)
      })
      .then((result) => settle(result.supported ? { status: 'ready', profiles: result.profiles } : { status: 'unsupported' }))
      .catch((error: unknown) => settle({ status: 'error', message: error instanceof Error ? error.message : String(error) }))
  }, [])

  const key = [...new Set(environmentIds)].sort().join('\n')
  useEffect(() => {
    if (key) for (const environmentId of key.split('\n')) load(environmentId)
  }, [key, load])

  return { catalogs, retry: load }
}
