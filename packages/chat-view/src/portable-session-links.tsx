import { useMemo, type ReactNode } from 'react'
import type { SessionLinkMetadataResult } from '@superone/shared/session-link'
import { requestNative, requestNativeAsync } from './bridge'
import { SessionLinkContext, type SessionLinkPorts } from './presenters/SessionChip'
import { createSessionLinkCache } from './presenters/session-link-cache'

/** Session chips on the phone: the shell resolves metadata and opens the target. */
export const portableSessionLinkPorts: SessionLinkPorts = {
  cache: createSessionLinkCache(async refs => {
    const result = await requestNativeAsync('sessionLinkMetadata', { refs }) as { metadata?: SessionLinkMetadataResult[] }
    return result.metadata ?? []
  }),
  open: async ref => { await requestNativeAsync('openSessionLink', { ref }, 120_000) },
  onError: error => { requestNative('sessionLinkError', { message: error instanceof Error ? error.message : 'Could not open session' }) },
}

export const invalidateSessionLinkMetadata = () => portableSessionLinkPorts.cache.clear()

export function PortableSessionLinkScope({ sourceEnvironmentId, children }: { sourceEnvironmentId?: string | null; children: ReactNode }) {
  const value = useMemo(() => ({ sourceEnvironmentId, ports: portableSessionLinkPorts }), [sourceEnvironmentId])
  return <SessionLinkContext.Provider value={value}>{children}</SessionLinkContext.Provider>
}
