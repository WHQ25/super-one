import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { EnvironmentHost } from '../environment/environment-host'
import log from '../logger'
import type { NotificationSessionDescription } from './notification-intent'

type NotificationHost = Pick<EnvironmentHost, 'listEnvironments' | 'getGateway'>

export interface NotificationSessionResolverDeps {
  describeLocal(sessionId: string): NotificationSessionDescription | undefined
  getHost(): NotificationHost | Promise<NotificationHost>
}

/** Read the owning host's session header; never connect, restore or take control. */
export function createNotificationSessionResolver(deps: NotificationSessionResolverDeps) {
  return (sessionId: string, projectPath?: string): NotificationSessionDescription | undefined | Promise<NotificationSessionDescription> => {
    const remote = projectPath && parseRemoteProjectKey(projectPath)
    if (!remote) return deps.describeLocal(sessionId)
    return (async () => {
      const host = await deps.getHost()
      const item = (await host.listEnvironments({ includeDescriptors: false }))
        .find(item => item.kind === 'remote' && item.connectionId === remote.connectionId)
      const fallback = { projectPath, environmentLabel: item?.label }
      if (!item || item.state !== 'connected') return fallback
      const gateway = host.getGateway(item.environmentId)
      if (!gateway) return fallback
      try {
        const record = await gateway.sessions.get({ environmentId: item.environmentId, sessionId }, { includeTranscript: false }) as { title?: string | null } | null
        return { ...fallback, title: record?.title }
      } catch (err) {
        log.warn('[notifications] remote session lookup failed node=%s session=%s: %s', remote.connectionId, sessionId, err instanceof Error ? err.message : String(err))
        return fallback
      }
    })()
  }
}
