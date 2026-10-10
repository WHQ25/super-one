import { isEnvironment } from '@superone/shared/environment/client-view'
import type { SessionRef } from '@superone/shared/environment/refs'
import { buildSessionLink, type SessionLinkMetadataResult, type SessionLinkTarget } from '@superone/shared/session-link'
import { parseRemoteProjectKey, remoteProjectKey } from '@superone/shared/remote-resource-key'
import { deriveHarnessId } from '../session/session-repo'
import { getDb } from '../database'
import { findSessionAcrossProjects, loadSessionState } from '../db-sessions'
import { getEnvironmentHost } from './environment-host'
import { localSessionEnvironmentId } from './session-identity'

export async function sessionEnvironmentId(projectPath: string): Promise<string | null> {
  const remote = parseRemoteProjectKey(projectPath)
  if (!remote) return localSessionEnvironmentId()
  const items = await getEnvironmentHost().listEnvironments({ includeDescriptors: false })
  return items.find(item => item.connectionId === (remote?.connectionId ?? 'local'))?.environmentId ?? null
}

/** No connection, transcript load, or control lease while Markdown renders. */
export async function sessionLinkMetadata(refs: SessionRef[]): Promise<SessionLinkMetadataResult[]> {
  if (!Array.isArray(refs) || refs.length > 50) throw new Error('At most 50 session references are allowed')
  for (const ref of refs) buildSessionLink(ref)
  const host = getEnvironmentHost()
  const items = await host.listEnvironments({ includeDescriptors: false })
  const results: SessionLinkMetadataResult[] = []
  for (const environmentId of new Set(refs.map(ref => ref.environmentId))) {
    const group = refs.filter(ref => ref.environmentId === environmentId)
    const item = items.find(item => isEnvironment(item, environmentId))
    if (item?.kind === 'local') {
      const rows = getDb().prepare(`SELECT id, provider, provider_id, acp_agent_id FROM sessions
        WHERE COALESCE(is_hidden, 0) = 0 AND id IN (${group.map(() => '?').join(',')})`).all(...group.map(ref => ref.sessionId)) as Array<{ id: string; provider: string | null; provider_id: string | null; acp_agent_id: string | null }>
      for (const ref of group) {
        const row = rows.find(row => row.id === ref.sessionId)
        results.push(row ? { status: 'ok', metadata: { ref, harness: deriveHarnessId(row), acpAgentId: row.acp_agent_id, environmentLabel: item.label } } : { status: 'unavailable', ref })
      }
    } else {
      const gateway = item?.state === 'connected' ? host.getGateway(environmentId) : null
      const found = await gateway?.sessions.getMetadataBatch?.(group).catch(() => []) ?? []
      results.push(...group.map(ref => found.find(result => { const target = result.status === 'ok' ? result.metadata.ref : result.ref; return target.environmentId === ref.environmentId && target.sessionId === ref.sessionId }) ?? { status: 'unavailable' as const, ref }))
    }
  }
  return results
}

/** Validate ownership and a restorable session before any renderer pane changes. */
export async function resolveSessionLinkTarget(ref: SessionRef): Promise<SessionLinkTarget> {
  buildSessionLink(ref)
  const host = getEnvironmentHost()
  const item = (await host.listEnvironments({ includeDescriptors: false })).find(item => isEnvironment(item, ref.environmentId))
  if (!item) throw Object.assign(new Error('Unknown session environment. Add or pair this host in Settings → Environments.'), { code: 'unknown_environment' })
  if (item.kind === 'local') {
    const row = findSessionAcrossProjects(ref.sessionId)
    if (!row || !loadSessionState(ref.sessionId)) throw new Error('Session is unavailable')
    return { ref, connectionId: null, projectPath: row.folderPath, title: row.title ?? '', harness: row.provider ?? '', acpAgentId: row.acpAgentId ?? null }
  }
  const descriptor = await host.connect(item.connectionId)
  if (descriptor.environmentId !== ref.environmentId) throw new Error('Session environment identity changed')
  const gateway = host.getGateway(ref.environmentId)
  const session = await gateway?.sessions.get(ref) as { projectId?: string; title?: string; harnessId?: string; providerId?: string; isHidden?: boolean } | null
  if (!session?.projectId || session.isHidden) throw new Error('Session is unavailable')
  const branding = (await gateway!.sessions.getMetadataBatch?.([ref]).catch(() => []) ?? [])[0]
  const project = await gateway!.getProject(session.projectId)
  if (!project) throw new Error('Session project is unavailable')
  return { ref, connectionId: item.connectionId, projectPath: remoteProjectKey(item.connectionId, project.path), title: session.title ?? '', harness: session.harnessId ?? '', acpAgentId: branding?.status === 'ok' ? branding.metadata.acpAgentId : null }
}
